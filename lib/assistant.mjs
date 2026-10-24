// The assistant: a persistent, scoped conversation with the configured model
// about this project, from wherever the reviewer is in it.
//
// One thread lives in the project's own state, so it survives page changes
// and a reload. Each turn carries the current paper or cell focus and drives the same tool
// loop a fill or verify run uses (lib/agent.mjs chatTurn), so the assistant
// can read the project's documents and the folders the reviewer added, and,
// in a cell's scope, propose a value the same way a run does — never write
// one itself (plan §6). A thread that grows past 200 messages has its oldest
// 100 folded into a running summary, so the conversation stays usable
// without paying to resend it in full on every turn.
import { get, update as storeUpdate, subscribe, projectGeneration } from '../store.mjs';
import { configured, complete } from './ai.mjs';
import { lazyModule } from './lazy.mjs';
import * as jobs from './jobs.mjs';
import { citationIntent, citationSeed, doiIn } from './citation-intake.mjs';
import { QUERY_DRAFT, CHAT_SUMMARY, CHAT, fence, refOf } from './prompts.mjs';
import { modelFor } from './model-settings.mjs';
import { checkpointOf, interruptedMessage } from './agent-runtime.mjs';
import { chatHistoryText } from './chat-content.mjs';
import { modelTeams } from './model-team-list.mjs';
import { settingsOf } from './app-settings.mjs';
import { sessionTime, sessionTitle, taskBudget, BUDGET_DEFAULT, TEAM_BUDGET_DEFAULT, BUDGET_LIMITS } from './chat-sessions.mjs';
import { archiveResearchMessages } from './research-ledger.mjs';
import { modeOf, modeBudget, modeTools, readsOf } from './chat-sessions.mjs';
// The tool titles of the status line load with the first turn, not at start (the startup graph's budget).
let progressText = null;
const loadProgressText = () => { if (!progressText) import('./assistant-activity.mjs').then(m => { progressText = m.progressText; }); };
// These writes contain only chat state and archival metadata, never the indexed
// scientific sources, evidence cells or review decisions.
const update = fn => storeUpdate(fn,{indexNeutral:true});

// A citation, DOI, RIS or BibTeX entry pasted into the chat is also offered as a
// Library reference: the turn carries a seed the reviewer opens in the
// reference form and saves there. Nothing is written until they do.
const awaitingCitations = new Map();
const lookupDoi = async (doi, options) => (await import('./sources.mjs')).lookupDoi(doi, options);

// Independent conversations per project. The scope — a cell, a paper, the project —
// follows what is open and goes with each message, but it no longer picks the
// thread: switching views mid-answer used to show another thread, and the
// answer arrived out of sight.
let scope = { kind: 'project' };
export function setScope(s) { scope = s || { kind: 'project' }; }
const THREAD = JSON.stringify({ kind: 'project' });
const runs = new Map();
export const sessions = () => get().threads || [];
const recentSession = list => list.slice().reverse().sort((a, b) => sessionTime(b) - sessionTime(a))[0] || null;
const existingThread = () => sessions().find(t => t.id === get().activeChatId) || recentSession(sessions().filter(t => !t.archivedAt));
export const currentSession = () => existingThread();
export const sessionName = t => sessionTitle(t, modelTeams().find(team => team.id === t?.teamId)?.name || '');
export const sessionTeam = () => modelTeams().find(t => t.id === existingThread()?.teamId) || null;
/** A chat without its own budget takes the default of Settings > AI > Models (`chatBudget`), else the built-in one (a team's is larger). */
export function defaultBudget(teamId = null) {
  const builtin=teamId?TEAM_BUDGET_DEFAULT:BUDGET_DEFAULT, own=settingsOf(get()).chatBudget||{};
  return {calls:Number(own.calls)||builtin.calls,tokens:Number(own.tokens)||builtin.tokens};
}
export function sessionBudget(t = existingThread()) {
  const defaults=defaultBudget(t?.teamId), {calls:[c0,c1],tokens:[t0,t1]}=BUDGET_LIMITS;
  const b=t?.budget||defaults;
  return {calls:Math.max(c0,Math.min(c1,Math.floor(Number(b.calls)||defaults.calls))),tokens:Math.max(t0,Math.min(t1,Math.floor(Number(b.tokens)||defaults.tokens)))};
}
export function sessionProfile(profiles, fallback) {
  const t = existingThread(), team = sessionTeam();
  const id = t?.teamId ? team?.leadProfileId : t?.profileId;
  if (t?.teamId && !team) return {provider:'',model:'',id:null};
  const cfg=id ? profiles.find(p => p.id === id) || {provider:'',model:'',id} : fallback;
  if (team) return {...cfg,model:team.leadModel||cfg.model,effort:team.leadEffort||''};
  return t?.modelOverride || t?.effort ? {...cfg,model:t.modelOverride||cfg.model,effort:t.effort||''} : cfg;
}
export function selectSession(id) {
  if (!sessions().some(t => t.id === id)) throw new Error('Chat not found.');
  update(s => {s.activeChatId=id;return s;}); activityChanged();
}
export function newSession({name='',profileId=null,teamId=null}={}) {
  const t={id:`th${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`,key:THREAD,name:name.trim().slice(0,80),nameManual:!!name.trim(),createdAt:Date.now(),scope,model:null,profileId,teamId,messages:[],compacted:null};
  update(s=>{s.threads=[...(s.threads||[]),t];s.activeChatId=t.id;return s;}); activityChanged();return t;
}
export function configureSession(values) {
  const id=thread().id;
  update(s=>{const t=s.threads.find(t=>t.id===id);for(const key of ['name','profileId','teamId','draft','modelOverride','effort','mode','reads'])if(key in values)t[key]=key==='name'?String(values[key]).trim().slice(0,80):values[key];if('budget' in values)t.budget=sessionBudget({...t,budget:values.budget});if('name' in values)t.nameManual=!!t.name;return s;});activityChanged();
}
export function renameSession(id, name) {
  const value = String(name || '').trim().slice(0, 80);
  if (!value || !sessions().some(t => t.id === id)) return;
  update(s => { const t = s.threads.find(t => t.id === id); t.name = value; t.nameManual = true; return s; }); activityChanged();
}
export function archiveSession(id, archived = true) {
  if (!sessions().some(t => t.id === id)) return;
  update(s => { const t = s.threads.find(t => t.id === id); t.archivedAt = archived ? Date.now() : null;
    if (archived && s.activeChatId === id) s.activeChatId = recentSession(s.threads.filter(t => !t.archivedAt))?.id || null;
    return s; }); activityChanged();
}
export function branchSession(id, index) {
  const source = sessions().find(t => t.id === id);
  if (!source || !Number.isInteger(index) || index < 0 || index >= source.messages.length) throw new Error('Message not found.');
  const messages = structuredClone(source.messages.slice(0, index + 1));
  const compacted = source.foldedTo && source.foldedTo <= index + 1 ? source.compacted : null;
  const next = newSession({ name: `${sessionName(source).slice(0, 70)} (branch)`, profileId: source.profileId, teamId: source.teamId });
  update(s => { const t = s.threads.find(t => t.id === next.id); Object.assign(t, {
    messages, model: source.model, modelOverride: source.modelOverride || null, effort: source.effort || '',
    compacted, foldedTo: compacted ? source.foldedTo : 0,
  }); return s; }); activityChanged(); return next;
}
export function thread() { return existingThread() || newSession(); }
let recovering = false;
export function recover() {
  const t = existingThread();
  if (runs.has(t?.id) || recovering || !t?.checkpoint) return;
  recovering = true;
  try { update(s => { const th=s.threads.find(x=>x.id===t.id); if(th?.checkpoint){th.messages.push(interruptedMessage(th.checkpoint));delete th.checkpoint;}return s; }); }
  finally { recovering = false; }
}
export const turns = () => { recover(); return existingThread()?.messages || []; };
export function clear() { const id=existingThread()?.id; stop();runs.delete(id);awaitingCitations.delete(id);update(s=>{const t=s.threads?.find(t=>t.id===id);if(t){archiveResearchMessages(s,id);t.messages=[];t.compacted=null;t.foldedTo=0;t.prunedMessages=0;delete t.checkpoint;}return s;}); }
export function removeSession(id) {runs.get(id)?.controller.abort();awaitingCitations.delete(id);update(s=>{archiveResearchMessages(s,id);s.threads=(s.threads||[]).filter(t=>t.id!==id);if(s.activeChatId===id)s.activeChatId=recentSession(s.threads.filter(t=>!t.archivedAt))?.id||null;return s;});activityChanged();}

/**
 * Roughly what a send will cost, in tokens, for the meta line: the instructions, the tool schemas a turn opens
 * with, the project brief, the running summary, the history window, the screen and the question. Characters
 * over four; the app's own estimate, not a provider's count.
 */
let toolChars = 0;
const schemaChars = engine => toolChars ||= JSON.stringify(engine.createChatTools({ getState: get, exec: async () => ({ content: '' }), capabilities: {}, history: [] }).tools).length;
/**
 * What a turn runs on (the agent loop, model teams and the tool set) loads with the first message, or when the cost line first asks for it
 * (`engineReady`, `ensureEngine`: lib/assistant-engine.mjs). A failed import is not kept, and says what could not load.
 */
const engine = lazyModule(() => import('./assistant-engine.mjs'), 'the assistant');
export const engineReady = engine.ready;
export const ensureEngine = engine.ensure;
/** The estimate, or null until the engine is here (the tool schemas are part of it). */
export function estimate(message, viewContext = '', focus = null) {
  const e = engine.module(); if (!e) return null;
  const t = existingThread();
  const history = e.chatHistory(t?.messages || [], '', t?.foldedTo || 0).reduce((a, m) => a + m.content.length, 0);
  const briefText = e.chatBrief(get(),message,focus), brief = briefText.length;
  const context = e.chatContext(get(),message,{focus,scopePaperId:scope.paper_id,viewContext,brief:briefText});
  return Math.ceil((e.CHAT_SYSTEM.length + schemaChars(e) + brief + String(t?.compacted || '').slice(0, 3000).length + history + context.length + String(message || '').length) / 4);
}

const listeners = new Set();
export const activity = () => runs.get(existingThread()?.id)?.run || null;
export function onActivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const activityChanged = () => { for (const fn of listeners) fn(); };
export const busy = () => runs.has(existingThread()?.id);
export const runningSessions = () => sessions().filter(t => runs.has(t.id));
export function stop() { const live=runs.get(existingThread()?.id);if(live){live.run.stopping=true;live.controller.abort();activityChanged();} }

export async function ask(message, { cfg, model = cfg?.model, viewContext = '', brief = '', focus = null, fileSource = null, actionContext = {}, attached = [] } = {}) {
  if (!configured(cfg)) throw new Error('No model configured');
  const text = String(message || '').trim().slice(0, 16000); if (!text) return null;
  recover();
  const t = thread();
  if(runs.has(t.id))throw new Error('This chat is already running.');
  if(runs.size>=4)throw new Error('Wait for a chat to finish; four chats can run together.');
  const identity=get().project, generation=projectGeneration(), controller = new AbortController();
  const citation = citationIntent(text, awaitingCitations.get(t.id));
  awaitingCitations.set(t.id,citation.awaiting);
  const turnScope = { ...scope };
  const team=t.teamId ? structuredClone(sessionTeam()) : null;
  if(t.teamId && !team)throw new Error('This model team was removed. Choose another team.');
  // Page navigation keeps this conversation; clearing it or changing projects
  // cancels the request before tools or a late reply can reach another project.
  const unsubscribe = subscribe(() => {
    if (get().project !== identity || projectGeneration() !== generation || !(get().threads || []).some(th => th.id === t.id)) controller.abort();
  });
  const turnId = `turn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const mode=modeOf(t), reads=readsOf(t), budget=modeBudget(taskBudget(text, sessionBudget(t), { paperCount: get().papers.length, explicit: !!t.budget || !!settingsOf(get()).chatBudget }), mode);
  const run = { turnId, startedAt: Date.now(), steps: [], active: { type: 'model', name: 'respond' }, model, budget };
  runs.set(t.id,{controller,run});activityChanged();
  const saveCheckpoint = () => { if(runs.get(t.id)?.controller!==controller || controller.signal.aborted)return; update(s=>{const th=s.threads.find(x=>x.id===t.id);if(th)th.checkpoint=checkpointOf(run);return s;}); };
  update(s => { const th = s.threads.find(x => x.id === t.id); th.archivedAt = null; th.messages.push({ id: turnId, role: 'user', text, cites: [], steps: [], usage: null, at: new Date().toISOString(), ...(attached.length ? { attached } : {}) }); th.model = model; th.checkpoint=checkpointOf(run); return s; });
  try {
    // A job, so the turn shows in the status bar and survives the panel closing.
    loadProgressText();
    const job = jobs.start(budget.major ? 'assistant-task' : 'model', budget.major ? sessionName(t) : 'Assistant', { threadId: t.id });
    const activity = st => {
      if (runs.get(t.id)?.controller !== controller || controller.signal.aborted) return;
      run.active = st;
      if (st.usage) run.usage = st.usage;
      if (st.modelCalls != null) run.modelCalls = st.modelCalls;
      job.progress(progressText ? progressText(run, get().papers) : 'Preparing response');
      activityChanged();
    };
    const step = st => { if (!controller.signal.aborted) { run.steps.push(st); run.active = null; saveCheckpoint(); activityChanged(); } };
    let r;
    try { const e = engine.module() || await engine.ensure(); r = await (team ? e.runModelTeam : e.chatTurn)({ team, budget, profiles:settingsOf(get()).models.profiles, onAgent:agents=>{if(!controller.signal.aborted){run.agents=structuredClone(agents);saveCheckpoint();activityChanged();}}, thread: t, text, cfg, model, scope: turnScope, signal: controller.signal, context: viewContext, stageBrief: brief, focus, fileSource, actionContext, mode, reads, ...modeTools(mode), onStep: step, onActivity: activity, onBlocks: blocks => { if (!controller.signal.aborted) { run.blocks = structuredClone(blocks); saveCheckpoint(); activityChanged(); } } }); if (controller.signal.aborted) job.cancel(); }
    catch (err) { if (controller.signal.aborted) job.cancel(); else job.fail(err); throw err; }
    if (controller.signal.aborted) return null;
    const msg = { role: 'assistant', text: r.text || (r.blocks?.length && r.reason === 'done' ? '' : r.reason === 'budget' ? 'Stopped at the budget. Saved work can be resumed.' : 'The model could not complete this answer. Saved work can be resumed.'), status: r.reason === 'done' ? 'done' : r.reason, durationMs: Date.now() - run.startedAt, cites: r.cites, steps: r.steps, blocks: r.blocks || [], ...(r.proposals?.length ? { proposals: r.proposals } : {}), ...(mode !== 'act' ? { mode } : {}), ...(reads === 'abstracts' ? { reads } : {}), usage: r.usage, budget, metrics:r.metrics, agents:r.agents||[],teamId:r.teamId||null,profileId:cfg.id||null,provider:cfg.provider, model, prompt: refOf(CHAT), at: new Date().toISOString() };
    if (citation.source) {
      let registry = null;
      const doi = doiIn(citation.source);
      if (doi) try { registry = await lookupDoi(doi, { signal: controller.signal }); } catch { /* the form still takes the details by hand */ }
      if (controller.signal.aborted) return null;
      msg.reference = citationSeed(citation.source, null, registry);
    }
    msg.id = `${turnId}-answer`;
    update(s => { const th = s.threads.find(x => x.id === t.id); if(th){th.messages.push(msg);archiveResearchMessages(s,t.id);if(th.checkpoint?.turnId===turnId)delete th.checkpoint;} return s; });
    run.answerSaved = true;
    const pendingPlan = msg.blocks?.find(b => b.type === 'plan')?.plan?.steps?.some(s => s.status !== 'done');
    job.done({ status: r.reason === 'done' && !pendingPlan ? 'completed' : 'incomplete', steps: r.steps?.length || 0, threadId: t.id });
    await foldIfLong(t.id, cfg, model, controller.signal);
    return msg;
  } catch (err) {
    if (!controller.signal.aborted) {
      const saved=run.blocks?.length || run.agents?.some(a=>a.text);
      update(s => { const th = s.threads.find(x => x.id === t.id); if (th) {th.messages.push({...interruptedMessage(checkpointOf(run),'error',`Could not complete the answer: ${String(err.message || err).slice(0, 200).replace(/[.]+$/,'')}.${saved?' Saved results are available; resume to continue.':' Try again.'}`)});if(th.checkpoint?.turnId===turnId)delete th.checkpoint;} return s; });
      throw err;
    }
    return null;
  } finally {
    unsubscribe();
    if (controller.signal.aborted && !run.answerSaved && get().project === identity && projectGeneration() === generation && runs.get(t.id)?.controller === controller) update(s => { const th = s.threads.find(x => x.id === t.id); if (th) {th.messages.push(interruptedMessage(checkpointOf(run),'stopped','Stopped. Saved results are available; resume to continue.'));archiveResearchMessages(s,t.id);if(th.checkpoint?.turnId===turnId)delete th.checkpoint;} return s; });
    if (runs.get(t.id)?.controller === controller) { runs.delete(t.id); activityChanged(); }
  }
}

// A conversation keeps every message for the person to read, but sends the model only the recent window
// (lib/agent.mjs chatHistory) and a running summary of what came before it. Once at least FOLD_BLOCK messages
// sit between the summary and the window, they are folded in: one call, on the cheap "compact" profile when
// the person set one up, with the previous summary carried forward. `foldedTo` counts the messages the summary
// covers. Past 300 messages the oldest 100 (all folded) are dropped from the stored thread.
const KEEP = 12, FOLD_BLOCK = 12, MAX_MESSAGES = 300;
async function foldIfLong(threadId, cfg, model, signal) {
  const identity=get().project, generation=projectGeneration();
  const t = (get().threads || []).find(x => x.id === threadId); if (!t) return;
  const folded = t.foldedTo || 0, upto = t.messages.length - KEEP;
  if (upto - folded < FOLD_BLOCK) return;
  const profile = compactProfile(cfg, model);
  const previous = t.compacted ? `Previous summary:\n${t.compacted}\n\nNew messages:\n` : '';
  const text = t.messages.slice(folded, upto).map(m => `${m.role}: ${chatHistoryText(m).slice(0, 5000)}`).join('\n');
  const summary = await complete(profile, [{ role: 'system', content: CHAT_SUMMARY.text }, { role: 'user', content: `${previous}${fence('conversation', text.slice(0, 60000))}` }], { signal, prompt: CHAT_SUMMARY, task: 'compact' }).catch(() => '');
  // With no summary nothing is marked as folded: those messages are still sent.
  if (signal?.aborted || get().project !== identity || projectGeneration() !== generation || !String(summary || '').trim()) return;
  update(s => {
    const th = s.threads.find(x => x.id === threadId); if (!th) return s;
    th.compacted = summary.trim().slice(0, 3000); th.foldedTo = upto;
    if (th.messages.length > MAX_MESSAGES && th.foldedTo >= 100) { archiveResearchMessages(s,threadId);th.messages = th.messages.slice(100); th.foldedTo -= 100;th.prunedMessages=(th.prunedMessages||0)+100; }
    return s;
  });
}
const compactProfile = (cfg, model) => { if (cfg.provider === 'chatgpt') return { ...cfg, model }; const c = modelFor('compact'); return configured(c) && c.id !== cfg.id ? c : { ...cfg, model }; };

/** The last question, asked again; the previous answer is dropped first. */
export function lastQuestion() { const m = turns(); const i = m.map(x => x.role).lastIndexOf('user'); return i >= 0 ? m[i].text : ''; }
export function dropLastExchange() { update(s => { const th = s.threads.find(x => x.id === existingThread()?.id); if (!th) return s; const i = th.messages.map(x => x.role).lastIndexOf('user'); if (i >= 0) {archiveResearchMessages(s,th.id,th.messages.slice(i));th.messages.splice(i);} return s; }); }

/** A PubMed query drafted from the protocol; the reviewer edits it in the box. */
export async function draftQuery(protocol, cfg, { signal } = {}) {
  if (!configured(cfg)) throw new Error('No model configured');
  const p = protocol || {};
  const lines = [
    p.title ? `Title: ${p.title}` : '', p.population ? `Population: ${p.population}` : '',
    p.intervention ? `Intervention: ${p.intervention}` : '', p.comparator ? `Comparator: ${p.comparator}` : '',
    p.outcome ? `Primary outcome: ${p.outcome}` : '', p.designs ? `Eligible designs: ${p.designs}` : '',
    ...(p.criteria || []).map(c => `${c.id}: ${c.text}`),
  ].filter(Boolean);
  if (!lines.length) throw new Error('The protocol has no question yet');
  const out = await complete(cfg, [
    { role: 'system', content: QUERY_DRAFT.text },
    { role: 'user', content: lines.join('\n').slice(0, 2500) },
  ], { signal, temperature: 0, prompt: QUERY_DRAFT });
  return out.replace(/^```[a-z]*\n?|```$/g, '').replace(/\s+/g, ' ').trim();
}

