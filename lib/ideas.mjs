// Ideas (plan §2, Projects page; review of 2026-10-12 §C4): a paper not yet a project, app-wide, kept on this machine. An idea is a title and
// an optional one-line question; it has no folder, records or stages. One action, Start project, opens the new-project dialog with the title
// filled in and marks the idea started. Pure list operations, plus `loadIdeas` and `saveIdeas` over localStorage (`lykos.ideas`).
export const IDEAS_KEY = 'lykos.ideas';
const str = v => (v == null ? '' : String(v)).trim();

/** An idea as kept: `{ id, title, question, at, startedAt }`; null when it has no title. */
export function normaliseIdea(x) {
  if (!x || typeof x !== 'object' || !str(x.title)) return null;
  return { id: str(x.id) || `i${Date.now().toString(36)}`, title: str(x.title).slice(0, 200), question: str(x.question).slice(0, 400), at: Number(x.at) || 0, startedAt: Number(x.startedAt) || 0 };
}
export const normaliseIdeas = list => (Array.isArray(list) ? list.map(normaliseIdea).filter(Boolean) : []);
/** "Title: question" typed in one field is split at the first colon; the newest idea first. */
export function addIdea(list, text, { id, at } = {}) {
  const t = str(text); if (!t) return normaliseIdeas(list);
  const i = t.indexOf(':');
  const idea = normaliseIdea({ id, at, title: i > 0 ? t.slice(0, i) : t, question: i > 0 ? t.slice(i + 1) : '' });
  return [idea, ...normaliseIdeas(list)];
}
export const removeIdea = (list, id) => normaliseIdeas(list).filter(x => x.id !== id);
export const markStarted = (list, id, at) => normaliseIdeas(list).map(x => (x.id === id ? { ...x, startedAt: at } : x));
/** The ideas still waiting, then the started ones. */
export const openIdeas = list => normaliseIdeas(list).filter(x => !x.startedAt);

export function loadIdeas(store = globalThis.localStorage) { try { return normaliseIdeas(JSON.parse(store?.getItem(IDEAS_KEY) || '[]')); } catch { return []; } }
export function saveIdeas(list, store = globalThis.localStorage) { try { store?.setItem(IDEAS_KEY, JSON.stringify(normaliseIdeas(list))); return true; } catch { return false; } }

/** The ideas as the Markdown file kept beside the projects (`Ideas.md`), so an agent and a text editor read them: waiting ones, then started. */
export function ideasMarkdown(list, { date = '' } = {}) {
  const all = normaliseIdeas(list), open = all.filter(x => !x.startedAt), started = all.filter(x => x.startedAt);
  const line = x => `- **${x.title.replace(/[*_]/g, '')}**${x.question ? `: ${x.question}` : ''}`;
  return [`# Ideas`, '', `Written by Lykos${date ? ` on ${date}` : ''}; add and start ideas on the Projects page. Edits here are not read back.`, '',
    '## Waiting', '', ...(open.length ? open.map(line) : ['None.']), '', ...(started.length ? ['## Started as projects', '', ...started.map(line), ''] : [])].join('\n');
}

/** Writes `Ideas.md` into the folder that holds the projects, in the desktop app; nothing happens elsewhere or when that folder is unknown. */
export async function exportIdeas(list) {
  try {
    const native = await import('./native.mjs');
    if (!native.inDesktop()) return false;
    const { lastParent, current } = await import('./projects.mjs'), { folderAtPath } = await import('./fsys.mjs');
    // the folder new projects go into, else the one that holds the open folder project ("Research Projects")
    const here = current?.(), open = here?.kind === 'path' && here.path ? String(here.path).replace(/\/+$/, '').replace(/\/[^/]+$/, '') : '';
    const root = lastParent() || open;
    if (!root) return false;
    await native.allowFoldersNative([root]).catch(() => {});
    await folderAtPath(root).writeText('Ideas.md', ideasMarkdown(list, { date: new Date().toISOString().slice(0, 10) }));
    return true;
  } catch { return false; }
}
