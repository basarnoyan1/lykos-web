// Whether the checks of lib/progress-checks.mjs are here, and whether the open project needs them. lib/progress.mjs and lib/research-workflow.mjs
// are read synchronously by the Overview, the rail and the status line, so they read `checks.module()`: when it is not loaded they leave out
// only what it would add (the manuscript's three rows, the reporting stage and its next step). The shell does not paint a project that
// `checksNeeded` until the module is here (app.mjs `paint`, and the first view), so a person never sees the shorter answer; a caller with no shell
// (a test, the MCP server) imports lib/progress-full.mjs first. A failed import is not kept (lib/lazy.mjs) and says what could not load.
import { get } from '../store.mjs';
import { lazyModule } from './lazy.mjs';
import { researchType } from './workflow.mjs';
import { isPrimaryType } from './research-types.mjs';

export const checks = lazyModule(() => import('./progress-checks.mjs'), 'the manuscript and reporting checks');
const manuscriptOrPrimary = s => Boolean(s.manuscript?.blocks?.length || isPrimaryType(researchType(s).id));
/** True when the open project (or `s`) would use the checks of lib/progress-checks.mjs and they are not here yet. */
export const checksNeeded = (s = get()) => !checks.ready() && manuscriptOrPrimary(s) || analysisNeeded(s);

// The input checks of the analyses a project has stored (lib/progress-analysis.mjs: the pooled, survival and advanced analyses, the trial log and the
// case report; 18 modules with the statistics they hash). Each answers 'none' (or nothing) for a project without the thing it checks, so a project
// with no stored analysis, no trial log and no case report never loads them. They come into the same gate as the checks above.
export const analysisChecks = lazyModule(() => import('./progress-analysis.mjs'), 'the analysis input checks');
const analysisUsed = s => Boolean(s.analysis || s.survival || s.advancedAnalyses?.length || s.trialOperations || researchType(s).id === 'case-report'
  || (s.analyses && Object.keys(s.analyses).length));
function analysisNeeded(s) { return !analysisChecks.ready() && analysisUsed(s); }
/** Loads whatever `checksNeeded` says the project uses, once. Rejects with `Could not load ...` and keeps nothing on a failure. */
export const ensureChecks = (s = get()) => Promise.all([
  !checks.ready() && manuscriptOrPrimary(s) ? checks.ensure() : null,
  analysisNeeded(s) ? analysisChecks.ensure() : null,
]).then(() => null);
/** Changes when either module arrives: an answer given before that is not kept (progress.mjs `perVersion`, the Overview's attention memo). */
export const checksKey = () => `${checks.ready()}${analysisChecks.ready()}`;

const A = () => analysisChecks.module();
/** The input checks, read synchronously: the module's answer, or the answer for a project that has nothing to check until it is here. */
export const inputs = {
  pooledInputStatus: (...a) => A()?.pooledInputStatus(...a) ?? 'none',
  survivalInputStatus: (...a) => A()?.survivalInputStatus(...a) ?? 'none',
  advancedInputStatus: (...a) => A()?.advancedInputStatus(...a) ?? 'none',
  trialReadiness: s => A()?.trialReadiness(s) ?? { issues: [] },
  visitStatus: (...a) => A()?.visitStatus(...a) ?? [],
  caseIssues: s => A()?.caseIssues(s) ?? [],
};
