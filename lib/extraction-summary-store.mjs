// The summary state's writers on the open project: each is the pure writer of ./extraction-summary-state.mjs inside one update(), and index
// neutral like setTransposed (nothing here changes what the search index holds).
import { update } from '../store.mjs';
import * as W from './extraction-summary-state.mjs';
import * as M from './extraction-summary-mapping.mjs';

const write = (fn, ...a) => update(s => fn(s, ...a), { indexNeutral: true });
export const approveMapping = (fieldId, mapping) => write(W.approveMapping, fieldId, mapping);
export const mergeCategories = (fieldId, ids, label) => write(W.mergeCategories, fieldId, ids, label);
export const renameCategory = (fieldId, id, label) => write(W.renameCategory, fieldId, id, label);
export const dropMapping = fieldId => write(W.dropMapping, fieldId);
export const markStatesFor = (fieldId, keys, role) => write(W.markStatesFor, fieldId, keys, role);
export const noteReview = (cellKey, notes) => write(W.noteReview, cellKey, notes);
export const setNoteState = (cellKey, id, state) => write(W.setNoteState, cellKey, id, state);
export const setColumns = (templateId, hidden) => write(W.setColumns, templateId, hidden);
export const applyMapping = (fieldId, add, opts) => write(M.applyMapping, fieldId, add, opts);
export const acceptDefinition = (fieldId, hash) => write(M.acceptDefinition, fieldId, hash);
export const cachePut = entries => write(M.cachePut, entries);
export const cacheTouch = keys => write(M.cacheTouch, keys);
export const recordRun = run => write(M.recordRun, run);
export const removeGrouping = fieldId => write(M.removeGrouping, fieldId);
export const fileReviewRun = (byCell, opts) => write(M.fileReviewRun, byCell, opts);
