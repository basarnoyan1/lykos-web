// For a caller with no shell to load the checks and the analysis input checks on demand (a test, tools/mcp/server.mjs): importing this loads them first, so
// lib/progress.mjs and lib/research-workflow.mjs answer in full. See lib/progress-gate.mjs.
import { checks, analysisChecks } from './progress-gate.mjs';
await Promise.all([checks.ensure(), analysisChecks.ensure()]);
