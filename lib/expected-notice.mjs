// The study panel's warning of the supplements an included study's article cites and the study does not hold (Assurance plan step 6,
// lib/expected-files.mjs): one uiNotice under the study's files, answered once for the study. Loaded by lib/study.mjs when the record's
// text named any supplement, so the shell's first view does not carry it.
import { missingOf, noticeText, answerExpected } from './expected-files.mjs';
import { lib_ui_actions$uiNotice as uiNotice } from "../boot.mjs";

/** The notice for the record's missing supplements, or ''. */
export function studyNotice(p) {
  const miss = missingOf(p);
  return miss.length ? uiNotice({ id: 'study-expected', label: 'Expected files', text: noticeText(miss),
    actions: [{ id: 'study-expected-answer', label: 'Not needed', attrs: { 'data-expected-answer': '' } }] }) : '';
}

/** Fills the panel's reserved slot (when the module loaded after the draw) and wires Not needed: it answers every file it names. */
export function wireNotice(slot, id, { get, update }) {
  if (!slot.isConnected) return;
  if (!slot.firstElementChild) slot.innerHTML = studyNotice((get().papers || []).find(x => x.id === id) || {});
  slot.querySelector('[data-expected-answer]')?.addEventListener('click', () => {
    update(s => { const q = (s.papers || []).find(x => x.id === id); if (q) answerExpected(q, 'not-needed'); return s; });
    slot.replaceChildren();
  });
}
