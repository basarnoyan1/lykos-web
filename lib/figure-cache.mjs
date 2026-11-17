// Loaded on the first figure a project reads or writes (lib/figures.mjs cacheFigures), not with the shell: work queue row 20.
import { lib_figures$folderFigureStore as folderFigureStore } from "../boot.mjs";

/**
 * Figures of a folder project in the per-user cache (storage design O4): `~/Library/Caches/Lykos/figures/<project id>/<hash>.svg`, read
 * and written by the shell (main.rs figure_cache_read / _write, src-tauri figure_cache.rs, 256 MB, least recently used first) and shared
 * with the tools and the MCP (tools/figure-cache.mjs). `idOf(create)`: the project's id (researchLedger.projectId), made when `create`.
 * A folder not yet converted keeps its figures in .lykos/figures: they are read from there, and only there are they listed and removed
 * by clean-up (the cache bounds itself). Without the shell (the hosted build) the cache keeps none: a figure lives for the session.
 */
export function cacheFigureStore(f, idOf, native = f.figureCache) {
  const legacy = folderFigureStore(f), session = new Map();
  const id = async create => { try { const v = await idOf?.(create); return /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/.test(v || '') ? v : null; } catch { return null; } };
  return { ...legacy, kind: 'cache',
    async get(h) {
      const i = native && await id(false), t = i ? await native.get(i, h).catch(() => null) : session.get(h);
      return t ?? legacy.get(h);
    },
    async put(h, text) { const i = native && await id(true); if (i) await native.put(i, h, text); else session.set(h, text); },
  };
}
