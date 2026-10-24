// Which records still need identifying, and who hears the progress. The shell asks this at start and after each save; lib/identify.mjs (the readers
// and the registry calls) loads only when the answer is not empty.
import { get } from '../store.mjs';

export const FILE_NAME = /^(?:[\w.-]*\d[\w.-]*|[\w-]+(?:_[\w-]+)+|.*\.pdf)$/i;

/**
 * Records that still need identifying. One already tried and left title-only
 * or unreadable is not pending again unless asked (retry): it was being tried
 * again every few seconds, each attempt a write that scheduled the next, which
 * repainted the view and called the registry for as long as the app was open.
 */
export function pending(s = get(), { retry = false } = {}) {
  return (s.papers || []).filter(p => p.pdf && (retry || !p.identified) && (
    FILE_NAME.test(p.title || '') || !(p.authors || []).some(a => String(a || '').trim()) || (!p.identified && (
      p.unidentified || !p.doi || p.source === 'file' || /^(file|pdf)-/.test(p.id)))));
}

export const listeners = new Set();
export const onProgress = fn => { listeners.add(fn); return () => listeners.delete(fn); };
