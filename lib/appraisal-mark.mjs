// A judgement as the traffic light draws it: a conventional colour, and a symbol that carries the meaning without it (a check, a dash, a cross, a
// warning for the worst level); a level with no tone (No information, Outcome not reported) is neutral and has no symbol. Shared by Appraisal's
// form, list and grid and by a study's Details (lib/study.mjs), so a judgement has one mark wherever it is read.
import { icon } from './icons.mjs';
import { JUDGEMENT_TONE } from '../schema.mjs';

const WORST = new Set(['Critical', 'Very high']);
const VERDICT_ICON = { good: 'check', unclear: 'minus', bad: 'close', critical: 'warn' };
/** The tone of a judgement: good, unclear, bad, critical, none, or '' when there is none. */
export const verdictTone = v => (!v ? '' : WORST.has(v) ? 'critical' : JUDGEMENT_TONE[v] || 'none');
/** The filled light of a judgement (aria-hidden: the judgement's words are beside it). */
export const verdictMark = v => { const tone = verdictTone(v); return `<span class="rob-mark" data-tone="${tone || 'empty'}" aria-hidden="true">${VERDICT_ICON[tone] ? icon(VERDICT_ICON[tone], { size: 10 }) : ''}</span>`; };
