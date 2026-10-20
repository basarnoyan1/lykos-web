// A run records the build's exact engine fingerprint. Bundle exports verify
// it and ship the source modules alongside frozen rows and an executable replay.
import { PRIMARY_ANALYSIS_VERSION } from './dataset-analysis.mjs';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
export async function verifyReplayEngine(pack) {
  if (pack?.format !== 'lykos-primary-engine' || pack.version !== 1 || pack.analysisVersion !== PRIMARY_ANALYSIS_VERSION
    || pack.entry !== 'lib/dataset-analysis.mjs' || !Array.isArray(pack.files) || !pack.files.length) throw new Error('Unsupported primary replay engine');
  const names = new Set();
  for (const f of pack.files) {
    if (!/^[\w./-]+\.mjs$/.test(f.name) || f.name.split('/').includes('..') || names.has(f.name) || typeof f.text !== 'string') throw new Error('Unsafe primary replay module');
    names.add(f.name);
    if (await digest(f.text) !== f.sha256) throw new Error(`Replay source checksum differs: ${f.name}`);
  }
  if (!names.has(pack.entry) || await digest(pack.files.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(f => `${f.name}\0${f.sha256}`).join('\n')) !== pack.fingerprint) throw new Error('Primary replay engine fingerprint differs');
  return pack;
}
let loading;
export async function loadReplayEngine() {
  if (!loading) loading = fetch(new URL('../assets/primary-analysis-engine.json', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error(`Primary replay engine is unavailable (${response.status})`);
    return verifyReplayEngine(await response.json());
  }).catch(err => { loading = null; throw err; });
  return loading;
}

// No browser, network, package install or third-party dependencies are needed.
export const REPLAY_RUNNER = `import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'engine.json'), 'utf8'));
const names = new Set();
for (const f of manifest.files) {
  if (!/^[\\w./-]+\\.mjs$/.test(f.name) || f.name.split('/').includes('..') || names.has(f.name)) throw new Error('Unsafe replay module');
  names.add(f.name);
  if (sha256(await fs.readFile(path.join(root, 'engine', f.name), 'utf8')) !== f.sha256) throw new Error('Source checksum differs: ' + f.name);
}
if (sha256(manifest.files.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(f => f.name + '\\0' + f.sha256).join('\\n')) !== manifest.fingerprint) throw new Error('Engine fingerprint differs');
const name = process.argv[2];
if (!name || path.basename(name) !== name || !name.endsWith('.json')) throw new Error('Usage: node run.mjs <filename from results/>');
const recipe = JSON.parse(await fs.readFile(path.join(root, 'results', name), 'utf8'));
if (recipe.implementation?.engineFingerprint !== manifest.fingerprint) throw new Error('The saved result requires a different engine');
const { replayAnalysis, replayPropensity, propensitySnapshot } = await import('./engine/lib/dataset-analysis.mjs');
const propensity = recipe.format === 'lykos-propensity-analysis';
if (propensity && recipe.version !== 1) throw new Error('Unsupported propensity recipe');
if (propensity && propensitySnapshot(recipe.saved.frozenData, recipe.saved.settings) !== recipe.saved.inputSnapshot) throw new Error('Frozen propensity inputs differ from their recorded snapshot');
const result = propensity ? replayPropensity(recipe.saved) : replayAnalysis(recipe);
const scientific = value => { const { at, id, implementation, currentSourceStatus, ...rest } = value; return rest; };
const same = JSON.stringify(propensity ? scientific(result) : result) === JSON.stringify(propensity ? scientific(recipe.saved) : recipe.result);
const output = name.replace(/\\.json$/, '.replayed.json');
await fs.writeFile(path.join(root, output), JSON.stringify({ matchesSavedResult: same, result }, null, 2) + '\\n');
console.log(JSON.stringify({ matchesSavedResult: same, output }));
if (!same) process.exitCode = 1;
`;
