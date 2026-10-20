// Appraisal, More, Import from a workbook: a risk-of-bias workbook made outside the app read into the project (lib/rob-import.mjs). The project
// folder's workbooks that look like one are offered first (by their name), any other file can be chosen; what will be written is said before it is.
import { update, get } from '../store.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { plural } from '../lib/dates.mjs';
import { readXlsx } from '../lib/xlsx-read.mjs';
import { readRobWorkbook, applyRob } from '../lib/rob-import.mjs';
import { allTools } from '../schema.mjs';
import { DEFAULTS } from '../lib/vcs.mjs';

const LOOKS_LIKE = /bias|\brob\b|rob[ _-]?2|robins|apprais|quality|jbi/i;
const SKIP = ['.lykos', '.git', 'node_modules', ...DEFAULTS.hashOnly.map(p => p.replace(/\/$/, ''))];

async function candidates(folder, rel = '', out = [], depth = 0) {
  if (depth > 4) return out;
  for (const e of await folder.list(rel).catch(() => [])) {
    const path = e.rel || (rel ? `${rel}/${e.name}` : e.name);
    if (e.dir) { if (!SKIP.includes(e.name)) await candidates(folder, path, out, depth + 1); }
    else if (/\.xlsx$/i.test(e.name) && !e.name.startsWith('~$') && LOOKS_LIKE.test(e.name)) out.push({ path, name: e.name, mtime: e.mtime || 0 });
  }
  return out;
}

/** Reads `bytes` as a workbook and, once the person agrees to what it holds, writes it into the project. */
async function importBytes(bytes, name, { say, rerender }) {
  let read;
  try { read = readRobWorkbook(await readXlsx(bytes), get()); } catch (err) { say(`${name} could not be read: ${err.message}`); return; }
  if (!read.studies.length) { say(`${name} has no risk-of-bias table`); return; }
  const tools = allTools(get()), by = {};
  for (const e of read.studies) by[e.tool] = (by[e.tool] || 0) + 1;
  const quotes = read.studies.reduce((n, e) => n + e.support.length, 0);
  const what = Object.entries(by).map(([id, n]) => `${n} ${tools.find(t => t.id === id)?.name || id}`).join(', ');
  const ok = await confirmAsk(`Import ${plural(read.studies.length, 'assessment')}?`,
    { detail: `${what}${quotes ? `; ${plural(quotes, 'supporting quotation')}` : ''}. A judgement already given for one of these studies is replaced by the workbook's.`, confirm: 'Import' });
  if (!ok) return;
  let res;
  update(st => { res = applyRob(st, read, { by: name }); return st; });
  say(`Imported ${plural(res.written.length, 'study', 'studies')}${res.unmatched.length ? `; not matched to an included study: ${res.unmatched.slice(0, 4).join(', ')}${res.unmatched.length > 4 ? '…' : ''}` : ''}`);
  rerender();
}

function pickFile(ctx) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx', hidden: true });
  document.body.append(input);
  input.onchange = async () => { const f = input.files?.[0]; input.remove(); if (f) await importBytes(new Uint8Array(await f.arrayBuffer()), f.name, ctx); };
  input.click();
}

/** Opens the choice of workbook under `anchor`: the project folder's likely ones, newest first, then any file. */
export async function importWorkbook(anchor, ctx) {
  const folder = activeFolder();
  const found = folder ? (await candidates(folder)).sort((a, b) => b.mtime - a.mtime).slice(0, 8) : [];
  if (!found.length) { pickFile(ctx); return; }
  showMenu(anchor, [...found.map(c => ({ label: c.name, meta: c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '', icon: 'table',
    run: async () => importBytes(await folder.read(c.path), c.name, ctx) })), '-', { label: 'Choose a file…', icon: 'file', run: () => pickFile(ctx) }], { align: 'end', minWidth: 320 });
}
