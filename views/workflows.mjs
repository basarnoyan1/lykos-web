import { REGISTRY } from './registry.mjs';
import { outputRecords } from '../lib/flow-records.mjs';
import { renderAnswerBlocks, wireAnswerBlocks } from '../lib/chat-blocks.mjs';
import { artifactHtml, downloadArtifact } from '../lib/research-artifacts.mjs';
import { teamMenu } from '../lib/team-editor.mjs';
import { blockPresentation } from '../lib/flow-presentation.mjs';
import { nextCronDates } from '../lib/flow-cron.mjs';
import { blockInputs } from '../lib/flow-inspection.mjs';
import { AGENT_TOOLS } from '../lib/flow-agent.mjs';
import { routedInput } from '../lib/flow-routing.mjs';
import { FLOW_VALUES, flowTextValues, resolveFlowText, insertFlowValue } from '../lib/flow-text.mjs';
import { FLOW_LIMITS, canvasWindow } from '../lib/flow-limits.mjs';
import { isJev } from '../lib/jev.mjs';
import { get, update, subscribe, projects } from '../store.mjs';
import { BLOCKS, validateFlow, runFlow, resumeFlow, retryFlow, stopFlow, workflowModels, preflight } from '../lib/flow-runner.mjs';
import { recordVersion, diffFlows, describeDiff, structureKey } from '../lib/flow-versions.mjs';
import { pageSpec as pagesHead, go as goPage, back as backPage, nav as pageNav, resetNavigation, renderPage, unmountPage } from './workflow-pages.mjs';
import { runWhen } from '../lib/workflow-history.mjs';
import { graphFlow, isSource, arrangeGraph, mergeRecords } from '../lib/flow-graph.mjs';
import { esc } from '../lib/html.mjs';
import { queryOutline } from '../lib/query-view.mjs';
import { icon } from '../lib/icons.mjs';
import { ask, askText, confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { FLOW_TEMPLATES, createFlowTemplate, BLOCK_DEFAULTS, usableHere } from '../lib/flow-blocks.mjs';
import { saveFile } from '../lib/save.mjs';
import { uiBar, uiGroup, uiNotice, uiList, menuAnchor } from '../lib/ui-actions.mjs';
import { disclosure } from '../lib/ui-components.mjs';
import * as I from './workflow-inspector.mjs';

/** The pager of a list inside the inspector: a count and two chevrons, one strip (spec 12.1). `next` null leaves the count alone. */
function pagerBar({ id, label, text, prev, next }) {
  return uiBar({ kind: 'strip', label, id, status: { text, ch: 24 }, actions: next ? [{ ...prev, icon: 'chevron-left' }, { ...next, icon: 'chevron-right' }] : [] });
}

/**
 * The editor's one row under the title bar: the canvas's own tools (the workflow's commands are the title bar's). A conflict notice, when the
 * saved workflow changed elsewhere, stands above it. Strings only, so it renders in Node (workflow-ids.test.mjs).
 */
export function editorToolsHtml({ conflict = false, waiting = false, galleryOpen = false } = {}) {
  return `${conflict ? uiNotice({ id: 'flow-conflict', label: 'Workflow changed', text: 'This workflow changed elsewhere.', actions: [{ id: 'flow-reload', label: 'Load saved changes', keep: true }] }) : ''}
    ${uiBar({ kind: 'tools', label: 'Workflow tools', id: 'flow-tools',
      actions: [{ id: 'flow-gallery', label: 'Add block', icon: 'plus', pressed: galleryOpen },
        uiGroup({ id: 'flow-history', label: 'History', items: [
          { id: 'flow-undo', label: 'Undo workflow edit', icon: 'undo', disabled: true }, { id: 'flow-redo', label: 'Redo workflow edit', icon: 'redo', disabled: true }] }),
        // reserved last: the room Review takes when it shows is spare room at the end, not a hole between Add block and History
        { id: 'flow-pending', label: 'Review', icon: 'check', presence: 'reserve', hidden: !waiting, pressed: false }] })}`;
}

/** The canvas strip: find, the zoom group (out, in, fit) and the zoom level; Arrange is a command in More. What an action reports is the title bar's message. */
export function canvasBarHtml({ navigatorOpen = false } = {}) {
  return uiBar({ kind: 'strip', label: 'Canvas', id: 'flow-canvas-tools', float: 'corner',
    actions: [{ id: 'flow-find', label: 'Find block', icon: 'search', kbd: '⌘F', pressed: navigatorOpen },
      uiGroup({ id: 'flow-zoom', label: 'Zoom', role: 'secondary', items: [{ id: 'flow-zoom-out', label: 'Zoom out', icon: 'minus' }, { id: 'flow-zoom-in', label: 'Zoom in', icon: 'plus' }, { id: 'flow-fit', label: 'Fit to view', icon: 'fit' }] }),
      { id: 'flow-actual', label: '100%', icon: 'gauge', dynamic: true, labelCh: 6, menu: true, attrs: { 'aria-label': 'Zoom level' } }],
    overflow: [{ id: 'flow-arrange', label: 'Arrange' }] });
}

export const meta = { title: 'Workflows', icon: 'workflow' };
/** The canvas draft, so the assistant can propose edits without it pasted into the chat box. */
export function assistContext() {
  if (!draft) return '';
  // Compact: one line per block (id, type, name, its main setting) and the
  // connections, so it fits the assistant's screen context.
  const cut = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const blocks = (draft.blocks || []).map(b => `${b.id} ${b.type}${b.label ? ` "${cut(b.label, 40)}"` : ''}${b.executor && b.executor !== 'automatic' ? ` [${b.executor}]` : ''}${b.query || b.instructions || b.text ? `: ${cut(b.query || b.instructions || b.text, 120)}` : ''}`);
  const edges = (draft.edges || []).map(e => `${e.from}→${e.to}${e.port ? `(${e.port})` : ''}`);
  return [`Workflow canvas "${cut(draft.name || 'Untitled workflow', 60)}" (${blocks.length} blocks, unsaved draft)`, ...blocks, edges.length ? `Connections: ${edges.join(', ')}` : 'No connections'].join('\n');
}
export const count = (...a) => REGISTRY.workflows.count(...a);
let blockKeys = null;
let blankChosen = null;   // the draft whose starter card was dismissed with Blank workflow
let draft = null, selection = null, connecting = null, owner = null, zoom = 1, galleryOpen = false, optionsOpen = false;
const def = b => BLOCKS.find(d => d.id === b.type);
const nodeLabel = b => b.label || def(b)?.label || b.type;
const nodeIcon = b => def(b)?.icon || 'note';
let panelMode = 'options';
let resultTab = 'output', resultPage = 0, resultQuery = '', resultRaw = false, resultKey = '';
let reviewNodeId = null, inspectorMode = 'settings', connectingPort = 'main', inspectedRunId = null;
const reviewDrafts = new Map();
const stateLabel = I.STATE_LABEL;
let historyId = null, undo = [], redo = [], snapshot = '';
const NODE_WIDTH = 240, PORT_Y = 50;
let navigatorOpen = false, navigatorQuery = '', navigatorStatus = '', navigatorPage = 0;
const cameraPositions = new Map();
let cleanupDrag = () => {}, unsubscribe = () => {}, sourceVersion = null, draftBase = null;
// The editor's commands as the title bar calls them: set while the editor is drawn (renderEditor), so a press always reaches the live canvas.
let editor = {};
let headKey = '';
const signature = flow => flow ? JSON.stringify({...flow,lastSlot:undefined,scheduleCheckedSlot:undefined,scheduledFor:undefined,scheduleAt:undefined,scheduleStatus:undefined,scheduleError:undefined}) : null;
export function openList() { screen = 'home'; resetNavigation(); }
export function unmount() { cleanupDrag(); unsubscribe(); unmountPage(); }
export const navigationState = () => ({workflow:screen==='editor'&&get().workflows?.some(f=>f.id===draft?.id)?draft.id:''});
export function restoreNavigation(state) {
  const saved=get().workflows?.find(f=>f.id===state.workflow);
  if(saved){owner=get().project;draft=graphFlow(structuredClone(saved));sourceVersion=signature(saved);draftBase=signature(draft);selection=connecting=null;screen='editor';resetNavigation('editor',{flowId:saved.id});}
  else { screen='home';resetNavigation(); }
}
// The view opens on the list of workflows (workflow-pages.mjs); the canvas is
// one page of it, entered from a row, a template or New workflow.
let screen='home';
const templateDraft=id=>{const next=createFlowTemplate(id);for(const b of next.blocks){const model=def(b).model||(b.executor==='ai'?'text':null);if(model)b.modelId=workflowModels().find(m=>(model==='jev')===isJev(m))?.id||'';}return next;};
function templateItems(pick){
  // Grouped by what the workflow is for.
  const groups=['Find literature','Review','Library'];
  return groups.map(g=>({label:g,submenu:usableHere(FLOW_TEMPLATES).filter(t=>t.group===g).map(t=>({label:t.name,run:()=>pick(t.id)}))}));
}
const latestRun = () => draft && (get().workflowRuns || []).find(r => r.flowId === draft.id && !r.parentRunId);
const isStored = () => !!draft && (get().workflows || []).some(f => f.id === draft.id);
const isDirty = () => !!draft && signature(draft) !== draftBase && (draft.blocks.length > 0 || !!String(draft.name || '').trim());
/** The page state of the open workflow, in one reserved slot: what runs, what waits, whether it is saved. */
function editorStatus() {
  const run = latestRun(), states = Object.values(run?.nodeStates || {}), n = run?.flow?.blocks?.length || 0;
  if (run?.status === 'running') return `Running · ${states.filter(s => ['done', 'skipped', 'error'].includes(s)).length} of ${n} done`;
  if (run?.status === 'waiting') return 'Waiting for review';
  if (isDirty()) return isStored() ? 'Unsaved changes' : 'Not saved';
  if (run?.status === 'failed') return 'Last run failed';
  return isStored() ? 'Saved' : 'Not saved';
}
const headState = () => JSON.stringify([draft?.name, isStored(), editorStatus(), latestRun()?.status, !!latestRun()?.cancelRequested, optionsOpen && !selection && panelMode]);

/** The title bar of the open workflow: its name (a picker of the other workflows), Back to the list, its state, Save and Run, and More. */
function editorPage() {
  const latest = latestRun(), busy = latest?.status === 'running', stored = isStored();
  const toggle = (id, label, mode) => ({ id, label, kind: 'toggle', checked: optionsOpen && !selection && panelMode === mode, run: () => editor.toggle?.(mode) });
  headKey = headState();
  return {
    title: String(draft.name || '').trim() || 'Untitled workflow', titleMenu: anchor => switchMenu(anchor), titleNoun: 'workflow',
    back: { label: 'Back to Workflows', run: () => editor.leave?.() },
    status: { text: editorStatus(), ch: 24 },
    actions: [{ id: 'flow-save', label: 'Save', icon: 'save', run: () => editor.save?.() },
      busy ? { id: 'flow-stop', label: 'Stop', icon: 'stop', role: 'primary', labelCh: 4, disabled: !!latest.cancelRequested, run: () => editor.stop?.() }
        // while a run waits for a review the review is the page's one primary (the pane's Complete and continue): Run waits, quiet
        : { id: 'flow-run', label: 'Run', icon: 'run', role: latest?.status === 'waiting' ? 'secondary' : 'primary', labelCh: 4, disabled: latest?.status === 'waiting', attrs: { 'aria-label': 'Save and run' }, run: () => editor.run?.() }],
    overflow: [{ id: 'flow-rename', label: 'Rename…', run: () => editor.rename?.() }, { id: 'flow-templates', label: 'Start from a template…', run: a => editor.templates?.(a) },
      { id: 'flow-check', label: 'Check before running', run: a => editor.check?.(a) }, { id: 'flow-help', label: 'Ask AI to edit…', run: () => editor.help?.() }, toggle('flow-options', 'Workflow options', 'options'), toggle('flow-runs', 'Run history', 'runs'), '-',
      ...(stored ? [{ id: 'flow-runs-page', label: 'Runs and checks', run: () => editor.leave?.(() => goPage('runs', { flowId: draft.id })) },
        { id: 'flow-versions', label: 'Versions', run: () => editor.leave?.(() => goPage('versions', { flowId: draft.id })) }, '-'] : []),
      { id: 'flow-duplicate', label: 'Duplicate workflow', run: () => editor.duplicate?.() }, { id: 'flow-export', label: 'Export workflow…', run: () => editor.exportFlow?.() },
      { id: 'flow-import', label: 'Import workflow…', run: () => editor.importFlow?.() },
      ...(stored ? ['-', { id: 'flow-delete', label: 'Delete workflow…', danger: true, run: () => editor.remove?.() }] : [])],
  };
}
/** The title's menu: the other workflows to switch to, and the list. */
function switchMenu(anchor) {
  const flows = [...(get().workflows || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  showMenu(anchor, [...flows.slice(0, 20).map(f => ({ label: f.name || 'Untitled workflow', checked: f.id === draft?.id, run: () => { if (f.id !== draft?.id) editor.leave?.(() => goPage('editor', { flowId: f.id, runId: null })); } })),
    ...(flows.length ? ['-'] : []), { label: 'All workflows', run: () => editor.leave?.() }], { minWidth: 220 });
}
let shell = null;
/** The title bar follows the editor without a repaint: its state, Run or Stop, the checked panels. */
function syncHead() {
  if (screen !== 'editor' || !draft) return;
  const key = headState(); if (key === headKey) return;
  if (shell?.chrome) shell.chrome(); else { headKey = key; shell?.status?.({ text: editorStatus(), ch: 24 }); }
}

function pagesApi(rerender) {
  const show = () => rerender?.();
  return {
    render: show,
    newWorkflow:anchor=>showMenu(menuAnchor(anchor),[{label:'Blank workflow',icon:'plus',run:()=>{draft=fresh();blankChosen=draft;galleryOpen=true;sourceVersion=draftBase=null;selection=connecting=null;optionsOpen=false;screen='editor';goPage('editor',{flowId:draft.id,runId:null});show();}},'-',{heading:'Templates'},...templateItems(id=>{draft=templateDraft(id);sourceVersion=draftBase=null;selection=connecting=null;optionsOpen=galleryOpen=false;screen='editor';goPage('editor',{flowId:draft.id,runId:null});show();})],{className:'flow-template-menu',align:'end'}),
    openEditor:(id,{review=false,inspectRun=null,node=null}={})=>{
      const saved=get().workflows?.find(f=>f.id===id);if(!saved)return;
      if(draft?.id!==id){draft=graphFlow(structuredClone(saved));sourceVersion=signature(saved);draftBase=signature(draft);}
      selection=connecting=null;optionsOpen=galleryOpen=false;
      if(review){optionsOpen=true;panelMode='review';}
      if(inspectRun){inspectedRunId=inspectRun;if(node){selection=node;inspectorMode='result';}else{optionsOpen=true;panelMode='runs';}}
      screen='editor';goPage('editor',{flowId:id,runId:inspectRun});show();
    },
  };
}
/** Which page shows and which workflow is open: read by the title bar (page) and the body (render), in either order. */
function sync() {
  if (owner !== projects().current) { owner = projects().current; sourceVersion = draftBase = null; draft = null; selection = connecting = null; screen = 'home'; resetNavigation(); }
  screen = pageNav.page === 'editor' ? 'editor' : 'home';
  if (screen === 'editor' && draft?.id !== pageNav.flowId) {
    const saved = get().workflows?.find(f => f.id === pageNav.flowId);
    if (saved) { draft = graphFlow(structuredClone(saved)); sourceVersion = signature(saved); draftBase = signature(draft); } else { resetNavigation(); screen = 'home'; }
  }
  if (screen === 'editor') draft ||= fresh();
}
/** The title bar (lib/topbar.mjs): the list's, a workflow's runs, versions or one run (workflow-pages.mjs), or the open workflow's. */
export function page(rerender) {
  sync();
  return screen === 'editor' ? editorPage() : pagesHead(pagesApi(rerender));
}
export function render(el, ctx) {
  shell = ctx;
  sync();
  if (screen !== 'editor') { cleanupDrag(); unsubscribe(); unsubscribe = () => {}; editor = {}; renderPage(el, pagesApi(ctx.rerender)); return; }
  unmountPage();
  renderEditor(el, ctx);
}
const fresh = () => ({ id: crypto.randomUUID(), name: '', blocks: [], edges: [], cron: '', enabled: false, concurrency:3 });
function renderEditor(el, ctx) {
  const oldViewport=el.querySelector('#flow-viewport');
  if(oldViewport)cameraPositions.set(oldViewport.dataset.flow,{left:oldViewport.scrollLeft,top:oldViewport.scrollTop,zoom});
  if(cameraPositions.size>20)cameraPositions.delete(cameraPositions.keys().next().value);
  cleanupDrag(); unsubscribe();
  if (owner !== projects().current) { owner = projects().current; sourceVersion = draftBase = null; draft = null; selection = null; connecting = null; }
  draft ||= fresh();
  const camera=cameraPositions.get(draft.id);zoom=camera?.zoom||1;
  if(historyId!==draft.id){historyId=draft.id;undo=[];redo=[];snapshot=JSON.stringify(draft);}
  const currentSaved = get().workflows?.find(f=>f.id===draft.id);
  const incomingVersion = signature(currentSaved);
  if (sourceVersion !== incomingVersion && signature(draft) === draftBase && currentSaved) { draft=graphFlow(structuredClone(currentSaved)); sourceVersion=incomingVersion; draftBase=signature(draft); }
  const conflict = sourceVersion !== incomingVersion;
  const custom = get().workflowBlocks || [];
  // This workflow's own runs; a run it makes when another workflow calls it is the caller's.
  const latest=latestRun();
  const waiting=(get().workflowRuns||[]).find(r=>r.flowId===draft.id&&!r.parentRunId&&r.status==='waiting');
  const inspectorShown = () => !!selection || optionsOpen;
  el.innerHTML = `<section class="flow-workspace" data-direction="${draft.direction === 'vertical' ? 'vertical' : 'horizontal'}">
    ${editorToolsHtml({ conflict, waiting: !!waiting, galleryOpen })}
    <div class="flow-layout${galleryOpen ? ' gallery-open' : ''}${inspectorShown() ? ' inspector-open' : ''}">
      <aside class="flow-palette" aria-label="Blocks"${galleryOpen ? '' : ' hidden'}>${I.paletteHtml(custom)}</aside>
      <aside class="flow-navigator" aria-label="Find block"${navigatorOpen ? '' : ' hidden'}>${I.finderHtml({ query: navigatorQuery, status: navigatorStatus })}</aside>
      <div class="flow-canvas-wrap">${canvasBarHtml({ navigatorOpen })}<div class="flow-viewport" id="flow-viewport" data-flow="${esc(draft.id)}" tabindex="0" aria-label="Workflow node canvas"><div class="flow-canvas" id="flow-canvas"><svg class="flow-wires" aria-label="Connections"></svg><div id="flow-nodes"></div></div></div></div>
      <aside class="flow-inspector" aria-label="Inspector"${inspectorShown() ? '' : ' hidden'}><div id="flow-inspector-head-host"></div><div id="flow-inspector-body"></div></aside>
    </div></section>`;
  const viewport = el.querySelector('#flow-viewport'), canvas = el.querySelector('#flow-canvas'), nodes = el.querySelector('#flow-nodes'), wires = el.querySelector('.flow-wires');
  const inspector = el.querySelector('.flow-inspector'), body = el.querySelector('#flow-inspector-body');
  // What an action reports is the title bar's message, cleared after a while.
  let feedbackTimer;
  const say = text => { ctx.say?.(text); clearTimeout(feedbackTimer); if (text) feedbackTimer = setTimeout(() => { if (el.isConnected) ctx.say?.(''); }, 7000); };
  const again = () => { if (!ctx.chrome && ctx.rerender) { ctx.rerender(); return; } renderEditor(el, ctx); syncHead(); };
  const remember = () => {const next=JSON.stringify(draft);if(next!==snapshot){undo.push(snapshot);undo=undo.slice(-60);let bytes=next.length;undo=undo.reverse().filter(item=>(bytes+=item.length)<=FLOW_LIMITS.historyBytes).reverse();redo=[];snapshot=next;}el.querySelector('#flow-undo').disabled=!undo.length;el.querySelector('#flow-redo').disabled=!redo.length;syncHead();};
  const restore = (from,to) => {if(!from.length)return;to.push(snapshot);snapshot=from.pop();draft=JSON.parse(snapshot);selection=connecting=null;again();};
  const redraw = () => { el.querySelector('.flow-layout').classList.toggle('inspector-open', inspectorShown()); inspector.hidden = !inspectorShown(); const scroll = [viewport.scrollLeft, viewport.scrollTop]; drawNodes(); drawInspector(); viewport.scrollLeft = scroll[0]; viewport.scrollTop = scroll[1]; };
  function connect(from, to, port='main') {
    if(draft.edges.length>=FLOW_LIMITS.edges)return say(`Up to ${FLOW_LIMITS.edges} connections per workflow.`);
    if (from === to) return say('A block cannot connect to itself.');
    if (draft.edges.some(e => e.from === from && e.to === to && (e.port||'main')===port)) return say('These blocks are already connected.');
    const seen = new Set(), stack = [to];
    while (stack.length) { const id = stack.pop(); if (id === from) return say('This connection would create a loop.'); if (seen.has(id)) continue; seen.add(id); stack.push(...draft.edges.filter(e => e.from === id).map(e => e.to)); }
    draft.edges.push({ from, to, ...(port!=='main'?{port}:{}) }); connecting = null; redraw(); say('');
  }
  const outputPorts=b=>[...(b.type==='condition'?[['match','Match'],['other','Other']]:[['main','Output']]),...(b.onError==='continue'?[['error','Error']]:[])];
  const nodeHeight=b=>draft.direction==='vertical'&&outputPorts(b).length>1?124:100;
  const nodeWidth=b=>outputPorts(b).length>1?260:NODE_WIDTH;
  const portShift=(b,port='main')=>{const ports=outputPorts(b),i=Math.max(0,ports.findIndex(([id])=>id===(port==='main'&&b.type==='condition'?'match':port)));return (i-(ports.length-1)/2)*(draft.direction==='vertical'?64:24);};
  const portPoint = (node, input = false, port='main') => draft.direction === 'vertical'
    ? [node.x + nodeWidth(node) / 2 + (input?0:portShift(node,port)), node.y + (input ? 0 : nodeHeight(node))]
    : [node.x + (input ? 0 : nodeWidth(node)), node.y + PORT_Y + (input?0:portShift(node,port))];
  const wirePath = (start, end, reverse = false) => {
    const [x,y] = start, [x2,y2] = end, sign = reverse ? -1 : 1;
    if (draft.direction === 'vertical') {
      const bend = Math.max(35,Math.abs(y2-y)/2);
      return `M${x} ${y} C${x} ${y+bend*sign},${x2} ${y2-bend*sign},${x2} ${y2}`;
    }
    const bend = Math.max(45,Math.abs(x2-x)/2);
    return `M${x} ${y} C${x+bend*sign} ${y},${x2-bend*sign} ${y2},${x2} ${y2}`;
  };
  function drawWires() {
    canvas.style.zoom = zoom;{const level=`${Number((zoom*100).toFixed(1))}%`,actual=el.querySelector('#flow-actual');actual.querySelector('.ui-act-label').textContent=level;actual.title=`Zoom level: ${level}`;}
    const reach = Math.max(viewport.clientWidth / zoom, ...draft.blocks.map(b => b.x + nodeWidth(b) + (viewport.clientWidth + 300) / (2 * zoom))), depth = Math.max(viewport.clientHeight / zoom, ...draft.blocks.map(b => b.y + 120 + viewport.clientHeight / (2 * zoom)));
    canvas.style.setProperty('--canvas-w', `${reach}px`); canvas.style.height = `${depth}px`; wires.setAttribute('viewBox', `0 0 ${reach} ${depth}`);
    const byId=new Map(draft.blocks.map(b=>[b.id,b]));
    const bounds={left:viewport.scrollLeft/zoom-240,top:viewport.scrollTop/zoom-240,right:(viewport.scrollLeft+viewport.clientWidth)/zoom+240,bottom:(viewport.scrollTop+viewport.clientHeight)/zoom+240};
    wires.innerHTML = draft.edges.map((e, i) => { const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) return '';
      if(Math.max(a.x,b.x)+240<bounds.left||Math.min(a.x,b.x)-240>bounds.right||Math.max(a.y,b.y)+140<bounds.top||Math.min(a.y,b.y)-140>bounds.bottom)return '';
      const path = wirePath(portPoint(a,false,e.port),portPoint(b,true)); return `<path class="flow-wire" d="${path}"/><path class="flow-wire-hit" data-edge="${i}" tabindex="0" role="button" aria-label="Connection from ${esc(nodeLabel(a))} to ${esc(nodeLabel(b))}${e.port?` · ${esc(e.port)}`:''}" d="${path}"><title>Remove connection</title></path>`; }).join('');
    if(zoom<.35){wires.insertAdjacentHTML('beforeend',draft.blocks.map(b=>`<rect class="flow-overview-node${b.id===selection?' selected':''}" data-overview="${esc(b.id)}" x="${b.x}" y="${b.y}" width="${nodeWidth(b)}" height="${nodeHeight(b)}" rx="6"><title>${esc(nodeLabel(b))}</title></rect>`).join(''));wires.querySelectorAll('[data-overview]').forEach(n=>n.onclick=()=>focusNode(n.dataset.overview));}
    wires.querySelectorAll('[data-edge]').forEach(path => { const remove = () => { draft.edges.splice(+path.dataset.edge, 1); redraw(); say(''); }; path.onclick = e => showMenu({x:e.clientX,y:e.clientY},[{label:'Remove connection',run:remove}]); path.onkeydown = e => { if (['Enter', 'Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); remove(); } }; });
  }
  function focusNode(id, result=false) {
    const b=draft.blocks.find(n=>n.id===id);if(!b){selection=id;inspectorMode='result';optionsOpen=true;redraw();return;}
    selection=id;inspectorMode=result?'result':'settings';optionsOpen=false;zoom=1;navigatorOpen=false;el.querySelector('.flow-navigator').hidden=true;
    drawWires();viewport.scrollTo({left:Math.max(0,b.x-(viewport.clientWidth-300)/2+100),top:Math.max(0,b.y-viewport.clientHeight/2+50)});redraw();syncHead();
  }
  function drawFinder() {
    const host=el.querySelector('#flow-find-results');if(!navigatorOpen)return;
    const run=latestRun(),q=navigatorQuery.toLowerCase().trim();
    const matches=draft.blocks.filter(b=>(!q||`${nodeLabel(b)} ${b.type} ${b.instructions||''} ${b.query||''}`.toLowerCase().includes(q))&&(!navigatorStatus||(run?.nodeStates?.[b.id]||'queued')===navigatorStatus));
    navigatorPage=Math.min(navigatorPage,Math.max(0,Math.ceil(matches.length/40)-1));const start=navigatorPage*40;
    const countText=matches.length?`${start+1}–${Math.min(start+40,matches.length)} of ${matches.length}`:'0 blocks';
    host.innerHTML=`${I.finderRowsHtml(matches.slice(start,start+40),b=>run?stateLabel[run.nodeStates?.[b.id]||'queued']:def(b)?.group||b.type)}${matches.length?pagerBar({ id: 'flow-find-pages', label: 'Blocks', text: countText, prev: { id: 'flow-find-prev', label: 'Previous blocks', disabled: !navigatorPage }, next: matches.length>40 ? { id: 'flow-find-next', label: 'Next blocks', disabled: start+40>=matches.length } : null }):''}`;
    host.querySelectorAll('[data-find-node]').forEach(b=>b.onclick=()=>focusNode(b.dataset.findNode,!!navigatorStatus));
    host.querySelector('#flow-find-prev')?.addEventListener('click',()=>{navigatorPage--;drawFinder();});host.querySelector('#flow-find-next')?.addEventListener('click',()=>{navigatorPage++;drawFinder();});
  }
  function closeFinder(){navigatorOpen=false;el.querySelector('.flow-navigator').hidden=true;syncPanelButtons();}
  function syncPanelButtons(){
    for(const [id,open] of [['flow-gallery',galleryOpen],['flow-find',navigatorOpen],['flow-pending',optionsOpen&&!selection&&panelMode==='review']]){
      const button=el.querySelector('#'+id);button?.setAttribute('aria-expanded',String(open));button?.setAttribute('aria-pressed',String(open));
    }
    // the panels the title bar's More opens show as checked entries there
    for(const [id,mode] of [['flow-options','options'],['flow-runs','runs']]) document.getElementById(id)?.setAttribute('aria-pressed',String(optionsOpen&&!selection&&panelMode===mode));
  }
  function toggleInspector(mode){
    optionsOpen=!(optionsOpen&&!selection&&panelMode===mode);selection=null;panelMode=mode;
    again();
  }
  function openFinder(){navigatorOpen=true;galleryOpen=false;el.querySelector('#flow-gallery').setAttribute('aria-pressed','false');el.querySelector('.flow-layout').classList.remove('gallery-open');el.querySelector('.flow-palette').hidden=true;el.querySelector('.flow-navigator').hidden=false;drawFinder();syncPanelButtons();el.querySelector('#flow-find-query').focus();}

  // ---- the inspector: one head and one of five bodies -------------------------------------------------------------------
  const runsOf = () => get().workflowRuns || [];
  /** The run the inspector shows: the one chosen (this workflow's, or a child of one of its runs), else the latest. */
  function shownRun() {
    const runs=runsOf(),chosen=runs.find(r=>r.id===inspectedRunId);
    return chosen&&(chosen.flowId===draft.id||runs.find(r=>r.id===chosen.rootRunId)?.flowId===draft.id)?chosen:latestRun();
  }
  const pickable = run => [...runsOf().filter(r=>r.flowId===draft.id&&!r.parentRunId),...(run?.parentRunId?[run]:[])];
  const whenOf = r => runWhen(r);
  /** What the inspector shows now. */
  function shownMode() {
    const b=draft.blocks.find(n=>n.id===selection),run=shownRun(),latest=latestRun();
    if(selection){
      if(b&&(!latest||inspectorMode==='settings'))return{mode:'settings',b};
      const block=run?.flow.blocks.find(n=>n.id===selection);
      if(run&&block)return{mode:'result',b,run,block};
      return b?{mode:'settings',b}:{mode:'none'};
    }
    if(!optionsOpen)return{mode:'none'};
    return{mode:panelMode,run};
  }
  const runMore = run => run ? [{ id: 'flow-run-download', label: 'Export run…' }, ...(run.status==='failed'&&!run.parentRunId?[{ id: 'flow-retry-inspected', label: 'Resume failed run' }]:[]),
    ...(run.steps||[]).filter(s=>s.artifact).map((s,i)=>({ id: `flow-artifact-${i}`, label: `Download ${s.artifact.name}`, attrs: { 'data-artifact-node': s.nodeId } }))] : [];
  function drawInspector() {
    syncPanelButtons();body.oninput=null;
    const shown=shownMode(),host=el.querySelector('#flow-inspector-head-host');
    if(shown.mode==='none'){host.innerHTML='';body.innerHTML='';return;}
    const title=shown.mode==='settings'?nodeLabel(shown.b):shown.mode==='result'?nodeLabel(shown.block):shown.mode==='runs'?'Run history':shown.mode==='review'?'Review task':'Workflow options';
    const overflow=shown.mode==='result'?[{ id: 'flow-data-raw', label: 'Show raw data', kind: 'toggle', checked: resultRaw }, { id: 'flow-data-export', label: 'Export block result…' }, '-', ...runMore(shown.run)]
      :shown.mode==='runs'?runMore(shown.run):[];
    // a block of a workflow that has run shows its settings or its result there: the switch stands under the head, named by the block
    const view=shown.mode==='settings'&&latestRun()?'settings':shown.mode==='result'&&draft.blocks.some(n=>n.id===shown.block.id)?'result':null;
    host.innerHTML=I.inspectorHeadHtml({ title, overflow })+(view?I.modeSwitchHtml(view,title):'');
    host.querySelectorAll('[data-inspector-mode]').forEach(button=>button.onclick=()=>{if(inspectorMode===button.dataset.inspectorMode)return;inspectorMode=button.dataset.inspectorMode;drawInspector();});
    host.querySelector('#flow-close').onclick=()=>{selection=null;optionsOpen=false;redraw();syncHead();};
    const run=shown.run;
    host.querySelector('#flow-run-download')?.addEventListener('click',()=>saveFile(JSON.stringify({run,children:runsOf().filter(r=>r.rootRunId===(run.rootRunId||run.id))},null,2),'workflow-run.json','application/json'));
    host.querySelector('#flow-retry-inspected')?.addEventListener('click',async()=>{try{await retryFlow(run.id);}catch(error){say(error.message);}again();});
    host.querySelectorAll('[data-artifact-node]').forEach(b=>b.addEventListener('click',()=>{const artifact=run.steps.find(s=>s.nodeId===b.dataset.artifactNode)?.artifact;if(artifact)saveFile(artifact.text,artifact.name,artifact.type);}));
    if(shown.mode==='settings')drawSettings(shown.b);
    else if(shown.mode==='result')drawResult(run,shown.block,host);
    else if(shown.mode==='runs')drawRuns(run);
    else if(shown.mode==='review')drawReview();
    else drawOptions();
  }
  const pickRun = () => { const pick=body.querySelector('#flow-run-pick'); if(pick)pick.onchange=e=>{inspectedRunId=e.target.value;selection=null;panelMode='runs';optionsOpen=true;redraw();syncHead();}; };

  function drawResult(run, block, head) {
    const detail=run.nodeDetails?.[block.id],step=run.steps.find(s=>s.nodeId===block.id);
    const key=run.id+':'+block.id;if(key!==resultKey){resultKey=key;resultPage=0;resultQuery='';resultRaw=false;}
    const state=run.imported&&!run.nodeStates?.[block.id]?'Not recorded':stateLabel[run.nodeStates?.[block.id]||'queued'];
    const inputs=blockInputs(run,block.id),pending=run.pendingNodes?.[block.id];
    const output={records:run.outputs?.[block.id]?outputRecords(run,block.id):pending?.records||[],text:run.texts?.[block.id]??pending?.text??'',payload:run.payloads?.[block.id]||pending?.payload||null};
    const logs=run.nodeLogs?.[block.id]||[];
    const children=(run.children?.[block.id]||[]).map(id=>runsOf().find(r=>r.id===id)).filter(Boolean);
    const parts=I.resultStatusParts({ state, detail, imported: !!run.imported, pending: !!pending, trimmed: resultTab==='logs'&&!!run.logsTrimmed?.[block.id] });
    body.innerHTML=`<div class="flow-form">${I.runPickHtml(pickable(run),run,whenOf)}</div>
      <section class="flow-result">${I.resultHeadHtml(resultTab)}${I.resultStatusHtml(parts)}${detail?.error?`<p class="flow-error">${esc(detail.error)}</p>`:''}<div id="flow-result-content"></div></section>${children.length?I.childRunsHtml(children):''}`;
    pickRun();
    const data=resultTab==='input'?inputs:resultTab==='output'?output:logs;
    head.querySelector('#flow-data-raw')?.addEventListener('click',()=>{resultRaw=!resultRaw;drawInspector();});
    head.querySelector('#flow-data-export')?.addEventListener('click',()=>saveFile(JSON.stringify(data,null,2),`block-${resultTab}.json`,'application/json'));
    body.querySelectorAll('[data-result-tab]').forEach(button=>button.onclick=()=>{if(resultTab===button.dataset.resultTab)return;resultTab=button.dataset.resultTab;resultPage=0;drawInspector();});
    body.querySelectorAll('[data-child-run]').forEach(button=>button.onclick=()=>{inspectedRunId=button.dataset.childRun;selection=null;panelMode='runs';optionsOpen=true;redraw();syncHead();});
    const content=body.querySelector('#flow-result-content');
    const records=resultTab==='input'?mergeRecords(inputs.filter(i=>i.active).map(i=>i.records)):resultTab==='output'?output.records:[];
    const empty=resultTab==='logs'?!logs.length:resultTab==='input'?!inputs.length:!output.text&&!records.length&&!output.payload;
    if(resultRaw&&!empty){content.innerHTML=`<pre class="flow-raw">${esc(JSON.stringify(data,null,2))}</pre>`;return;}
    if(resultTab==='logs'){
      // the error is said once, above: the log keeps the other events (as the run page's does)
      content.innerHTML=`${I.logsHtml(logs.filter(l=>!detail?.error||l.message!==detail.error),{dateOnly:!!run.dateOnly})}${detail?.tools?.length?I.toolCallsHtml(detail.tools,id=>AGENT_TOOLS.find(([k])=>k===id)?.[1]||id):''}${step?.model?`<p class="meta">Model: ${esc(step.model)}</p>`:''}`;return;
    }
    if(resultTab==='input')content.innerHTML=I.inputsResultHtml(inputs);
    else{
      content.innerHTML=empty?'<p class="meta">No output yet</p>':`${output.text?`<div class="flow-text">${esc(output.text)}</div>`:''}${output.payload?disclosure({ className: 'flow-list', id: 'flow-structured', title: 'Structured result', body: `<pre class="flow-raw">${esc(JSON.stringify(output.payload,null,2))}</pre>` }):''}`;
      if(output.payload?.kind==='model_team'){
        const blocks=(output.payload.blocks||[]).filter(b=>b.type==='artifact');
        content.insertAdjacentHTML('beforeend',`${renderAnswerBlocks(blocks,0,get())}<div id="flow-artifact"></div>`);
        // an artifact is read in the pane, under the answer: a page to read beside the canvas, never a dialog
        wireAnswerBlocks(content,[{blocks}],{download:(b,button)=>downloadArtifact(b.artifact,button),details:(_i,j)=>{content.querySelector('#flow-artifact').innerHTML=disclosure({ className: 'flow-list', id: 'flow-artifact-view', title: blocks[j].artifact.title, open: true, body: artifactHtml(blocks[j].artifact) });}});
      }
    }
    if(!records.length)return;
    content.insertAdjacentHTML('beforeend',`${records.length>10?uiBar({ kind: 'tools', label: 'Find a record', id: 'flow-record-tools', filters: [{ type: 'search', id: 'flow-record-query', label: 'Filter result records', placeholder: 'Find a record', value: resultQuery, width: 'flex' }] }):''}<div id="flow-result-records"></div>`);
    const drawRecords=()=>{const matches=records.filter(r=>`${r.title||r.label||''} ${r.doi||''} ${r.id||r.key||''}`.toLowerCase().includes(resultQuery.toLowerCase())),pages=Math.max(1,Math.ceil(matches.length/25));resultPage=Math.min(resultPage,pages-1);
      const list=content.querySelector('#flow-result-records');
      list.innerHTML=uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-records', label: 'Records', rows: I.recordRowsHtml(matches.slice(resultPage*25,(resultPage+1)*25)), empty: '<p class="meta">No matching records</p>' })+pagerBar({ id: 'flow-data-pagination', label: 'Records', text: `${matches.length?resultPage*25+1:0}–${Math.min(matches.length,(resultPage+1)*25)} of ${matches.length}`, prev: { id: 'flow-record-prev', label: 'Previous records', disabled: !resultPage }, next: pages>1 ? { id: 'flow-record-next', label: 'Next records', disabled: resultPage>=pages-1 } : null });
      list.querySelector('#flow-record-prev')?.addEventListener('click',()=>{resultPage--;drawRecords();});list.querySelector('#flow-record-next')?.addEventListener('click',()=>{resultPage++;drawRecords();});
    };drawRecords();content.querySelector('#flow-record-query')?.addEventListener('input',e=>{resultQuery=e.target.value;resultPage=0;drawRecords();});
  }

  function drawRuns(run) {
    if(!run){body.innerHTML='<p class="meta">No runs yet</p>';return;}
    const states=Object.values(run.nodeStates||{}),n=run.flow.blocks.length;
    const status=run.imported?'Imported':I.RUN_LABEL[run.status]||run.status;
    const many=n>12;
    body.innerHTML=`<div class="flow-form">${I.runPickHtml(pickable(run),run,whenOf)}</div>
      <p class="meta" id="flow-run-summary">${esc([status,run.imported?'':`${states.filter(s=>['done','skipped','error'].includes(s)).length} of ${n} done`].filter(Boolean).join(' · '))}</p>${run.error?`<p class="flow-error">${esc(run.error)}</p>`:''}
      ${many?uiBar({ kind: 'tools', label: 'Find a block', id: 'flow-run-tools', filters: [{ type: 'search', id: 'flow-run-search', label: 'Find a run block', placeholder: 'Find a block', width: 'flex' }] }):''}<div id="flow-run-blocks-host"></div>`;
    pickRun();
    const status1=id=>run.imported&&!run.nodeStates?.[id]?'Not recorded':stateLabel[run.nodeStates?.[id]||'queued'];
    const drawList=(query='')=>{const host=body.querySelector('#flow-run-blocks-host');host.innerHTML=I.runBlocksHtml(run.flow.blocks.filter(b=>nodeLabel(b).toLowerCase().includes(query.toLowerCase())).slice(0,80),status1);host.querySelectorAll('[data-inspect-node]').forEach(button=>button.onclick=()=>{inspectedRunId=run.id;focusNode(button.dataset.inspectNode,true);});};
    drawList();body.querySelector('#flow-run-search')?.addEventListener('input',e=>drawList(e.target.value));
  }

  function drawOptions() {
    body.innerHTML=I.optionsHtml(draft);
    const on=(id,ev,fn)=>body.querySelector('#'+id)?.addEventListener(ev,fn);
    const count=(value,min,max,fallback)=>{const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;};
    on('flow-retention','change',e=>{draft.keepRuns=Number(e.target.value);remember();});
    on('flow-agent-concurrency','change',e=>{draft.maxAgentConcurrency=count(e.target.value,1,16,4);e.target.value=draft.maxAgentConcurrency;remember();});
    on('flow-agent-limit','change',e=>{draft.maxAgentCalls=count(e.target.value,1,10000,1000);e.target.value=draft.maxAgentCalls;remember();});
    on('flow-concurrency','change',e=>{draft.concurrency=Number(e.target.value);remember();});
    on('flow-protected','change',e=>{draft.protected=e.target.checked;remember();});
    on('flow-enabled','change',e=>{draft.enabled=e.target.checked;remember();previewSchedule();});
    on('flow-schedule-preset','change',e=>{if(e.target.value){draft.cron=e.target.value;body.querySelector('#flow-cron').value=draft.cron;remember();previewSchedule();}});
    on('flow-cron','input',e=>{draft.cron=e.target.value;body.querySelector('#flow-schedule-preset').value=I.SCHEDULE_PRESETS.some(([v])=>v===draft.cron)?draft.cron:'';remember();previewSchedule();});
    on('flow-catch-up','change',e=>{draft.catchUp=e.target.value;remember();});
    previewSchedule();
  }
  function previewSchedule(){
    const host=body.querySelector('#flow-schedule-preview'),cron=body.querySelector('#flow-cron'),saved=get().workflows?.find(f=>f.id===draft.id);if(!host)return;
    if(!String(draft.cron||'').trim()){host.innerHTML='';return;}
    try{host.innerHTML=I.schedulePreviewHtml({dates:nextCronDates(draft.cron),enabled:!!draft.enabled,status:saved?.scheduleStatus||'',at:saved?.scheduleAt||'',error:saved?.scheduleError||''});cron?.removeAttribute('aria-invalid');}
    catch(error){host.innerHTML=`<p class="flow-error">${esc(error.message)}</p>`;cron?.setAttribute('aria-invalid','true');}
  }

  function drawReview() {
    const waitingRun=(get().workflowRuns||[]).find(r=>r.flowId===draft.id&&!r.parentRunId&&r.status==='waiting');
    if(!waitingRun){body.innerHTML='<p class="meta">Nothing waits for review</p>';return;}
    const pendingList=Object.values(waitingRun.pendingNodes||{[waitingRun.pending.nodeId]:waitingRun.pending});
    const p=pendingList.find(x=>x.nodeId===reviewNodeId)||waitingRun.pending;reviewNodeId=p.nodeId;
    const cache=reviewDrafts.get(waitingRun.id+':'+p.nodeId),block=p.block||waitingRun.flow.blocks.find(b=>b.id===p.nodeId);
    body.innerHTML=I.reviewHtml({ pending: pendingList, current: p, block, cache, labelOf: id => nodeLabel(waitingRun.flow.blocks.find(b=>b.id===id)||{type:''}) });
    const keep=()=>reviewDrafts.set(waitingRun.id+':'+p.nodeId,{text:body.querySelector('#flow-review-text')?.value,query:body.querySelector('#flow-review-query')?.value,recordIds:[...body.querySelectorAll('[data-record]:checked')].map(c=>p.records[+c.dataset.record].id||p.records[+c.dataset.record].key)});
    const resume=async approve=>{try{const files=await Promise.all([...(body.querySelector('#flow-review-files')?.files||[])].map(async f=>({name:f.name,text:await f.text()}))),text=body.querySelector('#flow-review-text')?.value,query=body.querySelector('#flow-review-query')?.value,recordIds=[...body.querySelectorAll('[data-record]:checked')].map(c=>p.records[+c.dataset.record].id||p.records[+c.dataset.record].key);body.querySelectorAll('button').forEach(b=>b.disabled=true);const result=await resumeFlow(waitingRun.id,{nodeId:p.nodeId,approve,text,recordIds,query,files});reviewDrafts.delete(waitingRun.id+':'+p.nodeId);panelMode=result.status==='waiting'?'review':'runs';selection=null;again();say(result.status==='waiting'?'Waiting for your input':result.status==='cancelled'?'Run stopped':'Workflow completed');}catch(e){say(e.message);body.querySelectorAll('button').forEach(b=>b.disabled=false);}};
    body.querySelector('#flow-review-node')?.addEventListener('change',e=>{keep();reviewNodeId=e.target.value;drawInspector();});
    body.oninput=keep;
    body.querySelector('#flow-open-screening')?.addEventListener('click',()=>ctx.go?.('screening'));
    body.querySelector('#flow-approve').onclick=()=>resume(true);body.querySelector('#flow-reject').onclick=()=>resume(false);
  }

  function drawSettings(b) {
    const blockIndex=new Map(draft.blocks.map(n=>[n.id,n])),presentation=n=>blockPresentation(n,{...get(),models:workflowModels(),flow:draft});
    const connected=isSource(b)?null:draft.edges.filter(e=>e.to===b.id);
    const inputs=connected?.map(edge=>{const from=blockIndex.get(edge.from);return{label:from?nodeLabel(from):'Missing block',detail:[edge.port&&edge.port!=='main'?({match:'Match',other:'Other',error:'Error'})[edge.port]:'',from?presentation(from).primary:''].filter(Boolean).join(' · ')};});
    const models=workflowModels().filter(m=>(def(b).model==='jev')===isJev(m));
    body.innerHTML=`${I.settingsHtml(b,{ models, teams: get().modelTeams||[], collections: get().collections||[], inputs,
      workflows: (get().workflows||[]).filter(f=>f.id!==draft.id&&f.blocks?.some(n=>n.type==='input')&&f.blocks?.some(n=>n.type==='output')) })}`;
    const panel=body;
    panel.querySelector('#flow-team-pick')?.addEventListener('click',e=>teamMenu(e.currentTarget,{manage:()=>ctx.openTeams?.(),choose:team=>{b.teamId=team.id;drawInspector();drawNodes();}}));
    if(connected){
      const descendants=new Set(),queue=[b.id];while(queue.length){const id=queue.pop();if(descendants.has(id))continue;descendants.add(id);queue.push(...draft.edges.filter(e=>e.from===id).map(e=>e.to));}
      const picker=panel.querySelector('#flow-input-picker'),search=panel.querySelector('#flow-connect-query'),add=panel.querySelector('#flow-add-input');
      const inputChoices=()=>{
        const q=search.value.trim().toLowerCase(),matches=draft.blocks.filter(n=>!descendants.has(n.id)&&nodeLabel(n).toLowerCase().includes(q)).flatMap(n=>outputPorts(n).filter(([port])=>!connected.some(e=>e.from===n.id&&(e.port||'main')===port)).map(([port,label])=>({id:n.id,port,label:nodeLabel(n),detail:[outputPorts(n).length>1?label:'',presentation(n).primary].filter(Boolean).join(' · ')})));
        const host=panel.querySelector('#flow-input-choices');host.innerHTML=I.inputChoicesHtml(matches.slice(0,8),matches.length);
        host.querySelectorAll('[data-connect-source]').forEach(button=>button.onclick=()=>connect(button.dataset.connectSource,b.id,button.dataset.connectPort));
      };
      const closePicker=()=>{picker.hidden=true;add.setAttribute('aria-expanded','false');add.setAttribute('aria-pressed','false');};
      add.onclick=()=>{picker.hidden=!picker.hidden;add.setAttribute('aria-expanded',String(!picker.hidden));add.setAttribute('aria-pressed',String(!picker.hidden));if(!picker.hidden){inputChoices();search.focus();}};
      search.oninput=inputChoices;search.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();panel.querySelector('[data-connect-source]')?.focus();}if(e.key==='Escape'){closePicker();add.focus();}};
      const disconnect=i=>{const edge=connected[i];draft.edges=draft.edges.filter(e=>e!==edge);redraw();};
      panel.querySelectorAll('[data-disconnect-index]').forEach(button=>button.onclick=()=>disconnect(Number(button.dataset.disconnectIndex)));
      panel.querySelectorAll('[data-input-more]').forEach(button=>button.onclick=()=>{const i=Number(button.dataset.inputMore),edge=connected[i];showMenu(button,[{label:'Select block',run:()=>focusNode(edge.from)},{label:'Disconnect',run:()=>disconnect(i)}],{align:'end'});});
    }
    panel.querySelectorAll('[data-agent-tool]').forEach(input=>input.onchange=()=>{b.tools=[...panel.querySelectorAll('[data-agent-tool]:checked')].map(i=>i.dataset.agentTool);remember();});
    const executor=panel.querySelector('#flow-executor');if(executor)executor.onchange=e=>{b.executor=e.target.value;if(b.executor==='ai'){b.review=true;b.modelId ||= workflowModels()[0]?.id||'';}drawInspector();drawNodes();};
    const preview=()=>{
      const host=panel.querySelector('#flow-text-preview');if(!host)return;
      const parents=draft.edges.filter(e=>e.to===b.id).map(e=>e.from),run=latestRun();
      const sameInputs=run&&JSON.stringify((run.flow.edges||[]).filter(e=>e.to===b.id).map(e=>e.from))===JSON.stringify(parents);
      const actual=parents.length&&sameInputs&&parents.every(id=>run.nodeStates?.[id]==='done');
      const routed=actual?draft.edges.filter(e=>e.to===b.id).map(e=>routedInput(draft,run,e)).filter(i=>i.active):[];
      const context=actual?{count:mergeRecords(routed.map(i=>i.records)).length,output:routed.map(i=>i.text).filter(Boolean).join('\n\n')}:{count:3,output:'Text from the previous step'};
      const value=panel.querySelector('textarea[data-field="text"]').value;
      host.textContent=resolveFlowText(value,context)||'Nothing to show';const source=panel.querySelector('#flow-preview-source');if(source)source.textContent=actual?'Last run inputs':'Example';
      const unknown=[...new Set(flowTextValues(value).filter(v=>!FLOW_VALUES.some(f=>f.key===v.key)).map(v=>v.key))],warning=panel.querySelector('#flow-value-warning');
      warning.textContent=unknown.length?`Unknown value: ${unknown.join(', ')}`:flowTextValues(value).some(v=>v.key==='output')&&!parents.length?'Connect an input to use previous output.':'';warning.hidden=!warning.textContent;
    };
    panel.querySelector('#flow-insert')?.addEventListener('click',e=>showMenu(e.currentTarget,FLOW_VALUES.map(v=>({label:v.label,meta:v.description,run:()=>{
      const input=panel.querySelector('textarea[data-field="text"]'),next=insertFlowValue(input.value,v.key,input.selectionStart,input.selectionEnd);
      input.value=b.text=next.text;input.focus();input.setSelectionRange(next.caret,next.caret);drawNodes();preview();
    }})),{minWidth:220}));preview();
    panel.querySelectorAll('[data-field]').forEach(input => { input.oninput = () => { b[input.dataset.field] = input.dataset.field==='retries'?Number(input.value):input.value; drawNodes();preview();
      const outline=panel.querySelector('#flow-query-outline');if(outline&&(input.dataset.field==='query'||input.dataset.field==='source'))outline.innerHTML=queryOutline(b.query||'',{source:b.source}); }; });
    panel.querySelector('#flow-note-content')?.addEventListener('change', e => {
      const fromOutput = e.target.value === 'output', field = panel.querySelector('#flow-note-text');
      field.hidden = fromOutput;
      b.text = fromOutput ? '{{output}}' : field.querySelector('textarea').value;
      drawNodes();
      if (!fromOutput) field.querySelector('textarea').focus();preview();
    });
    panel.querySelector('#flow-review-required')?.addEventListener('change',e=>{b.review=e.target.checked;drawNodes();});
    panel.querySelector('#flow-model-setup')?.addEventListener('click',()=>ctx.openModelSettings?.());
    panel.querySelector('#flow-reuse').onclick=async()=>{const name=await ask('Custom block name',{value:b.label||nodeLabel(b)});if(!name?.trim())return;const block=structuredClone(b);delete block.id;delete block.x;delete block.y;block.label=name.trim();update(s=>{s.workflowBlocks=[...(s.workflowBlocks||[]),{id:crypto.randomUUID(),name:name.trim(),block}];return s;});again();};
    panel.querySelector('#flow-duplicate-block').onclick=()=>{if(draft.blocks.length>=FLOW_LIMITS.blocks)return say(`Up to ${FLOW_LIMITS.blocks} blocks per workflow.`);const copy={...structuredClone(b),id:crypto.randomUUID(),x:b.x+40,y:b.y+110};draft.blocks.push(copy);selection=copy.id;redraw();};
    panel.querySelector('#flow-remove').onclick = () => { draft.blocks = draft.blocks.filter(n => n.id !== b.id); draft.edges = draft.edges.filter(e => e.from !== b.id && e.to !== b.id); selection = connecting = null; redraw(); syncHead(); };
  }

  let reviewKey='';
  function drawRunStates() {
    const run=latestRun();
    for(const article of nodes.querySelectorAll('[data-node]')) {
      const status=run?.nodeStates?.[article.dataset.node] || (run&&!run.imported?'queued':'');
      article.dataset.status=status;const button=article.querySelector('[data-node-state]'),detail=run?.nodeDetails?.[article.dataset.node];button.hidden=!run||!status;button.textContent=status==='done'&&detail&&run.imported?(detail.outputCount!=null?(detail.inputCount!=null?`${detail.inputCount} → ${detail.outputCount}`:`${detail.outputCount} out`):stateLabel[status]):status==='done'&&detail?`${detail.inputCount||0} → ${detail.outputCount||0}`:stateLabel[status]||'';button.title=[stateLabel[status],detail?.error,detail?.durationMs!=null?`${(detail.durationMs/1000).toFixed(1)} s`:''].filter(Boolean).join(' · ');button.onclick=e=>{e.stopPropagation();inspectedRunId=run.id;focusNode(article.dataset.node,true);};
    }
    const pending=el.querySelector('#flow-pending');if(pending)pending.hidden=run?.status!=='waiting';
    syncHead();
    // a run that moves on redraws what the inspector shows of it; a block's settings are left alone while they are edited
    const mode=shownMode().mode,waitingRun=(get().workflowRuns||[]).find(r=>r.flowId===draft.id&&!r.parentRunId&&r.status==='waiting'),key=JSON.stringify([waitingRun?.id,Object.keys(waitingRun?.pendingNodes||{})]);
    if(mode==='result'||mode==='runs'||(mode==='review'&&key!==reviewKey))drawInspector();
    reviewKey=key;
    drawFinder();
  }
  // The starter card owns an empty canvas: the strip's wrapper stays hidden while it shows (it still takes no room in the page).
  function syncStrip(){const wrap=el.querySelector('#flow-canvas-tools')?.parentElement;if(wrap)wrap.hidden=!!nodes.querySelector('.flow-empty');}
  function drawNodes(viewOnly=false) {
    if(!viewOnly){remember();cleanupDrag();}
    const visible=zoom<.35?[]:canvasWindow(draft.blocks,{left:viewport.scrollLeft,top:viewport.scrollTop,width:viewport.clientWidth,height:viewport.clientHeight,zoom,selected:selection});
    const blockIndex=new Map(draft.blocks.map(b=>[b.id,b])),inputIndex=new Map(draft.blocks.map(b=>[b.id,[]]));for(const edge of draft.edges)inputIndex.get(edge.to)?.push(edge.from);
    const presentationContext={...get(),models:workflowModels(),flow:draft,blockIndex,inputIndex};
    const outputPort=b=>([port,label])=>`<button class="flow-port output${connecting===b.id&&connectingPort===port?' connecting':''}" data-output="${esc(b.id)}" data-output-port="${port}" style="--port-shift:${portShift(b,port)}px" title="${label}" aria-label="${label} from ${esc(nodeLabel(b))}" aria-pressed="${connecting===b.id&&connectingPort===port}"><i></i>${outputPorts(b).length>1?`<span>${label}</span>`:''}</button>`;
    nodes.innerHTML = visible.map(b => {const info=blockPresentation(b,presentationContext);return `<article class="flow-node${selection === b.id ? ' selected' : ''}" data-node="${esc(b.id)}" data-category="${esc(def(b).group)}" data-multi-output="${outputPorts(b).length>1}" data-needs-setup="${!!info.attention}" style="left:${b.x}px;top:${b.y}px;--node-w:${nodeWidth(b)}px;height:${nodeHeight(b)}px"><button class="flow-node-title" data-select="${esc(b.id)}" aria-label="Configure ${esc(nodeLabel(b))}" title="${esc(nodeLabel(b))}">${icon(nodeIcon(b))}<strong>${esc(nodeLabel(b))}</strong></button><p class="flow-node-summary" title="${esc(info.primary)}">${esc(info.primary)}</p><div class="flow-node-footer"><span class="flow-node-detail" title="${esc(info.secondary)}">${esc(info.secondary)}</span><button data-node-state title="Inspect block result" aria-label="Inspect ${esc(nodeLabel(b))} result" hidden></button></div><div class="flow-ports">${isSource(b) ? '' : `<button class="flow-port input" data-input="${esc(b.id)}" title="Records and text input" aria-label="Input for ${esc(nodeLabel(b))}"><i></i></button>`}${outputPorts(b).map(outputPort(b)).join('')}</div></article>`;}).join('') || (draft.blocks.length||blankChosen===draft?'':I.starterHtml());
    syncStrip();
    nodes.querySelectorAll('[data-node]').forEach(button => {
      button.onclick = e => { if(e.target.closest('.flow-port,[data-node-state]'))return;focusNode(button.dataset.node); };
      button.onpointerdown = e => {
        if (e.button !== 0 || e.target.closest('.flow-port,[data-node-state]')) return;e.preventDefault();
        const b = draft.blocks.find(n => n.id === button.dataset.node), article = button.closest('.flow-node'), start = { x: e.clientX, y: e.clientY, bx: b.x, by: b.y }; let moved = false;
        button.setPointerCapture(e.pointerId);
        button.onpointermove = ev => { const dx = ev.clientX - start.x, dy = ev.clientY - start.y; if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return; moved = true; b.x = Math.max(20, start.bx + dx / zoom); b.y = Math.max(20, start.by + dy / zoom); article.style.left = `${b.x}px`; article.style.top = `${b.y}px`; drawWires(); };
        button.onpointerup = () => { button.onpointermove = null; if (moved) {remember();say('');} };
      };
      button.onkeydown = e => { if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); const b = draft.blocks.find(n => n.id === button.dataset.node); b.x = Math.max(20, b.x + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0)); b.y = Math.max(20, b.y + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0)); redraw(); nodes.querySelector(`[data-select="${b.id}"]`).focus(); };
    });
    nodes.querySelectorAll('[data-output], [data-input]').forEach(port => {
      let dragged = false;
      port.onpointerdown = e => {
        if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); cleanupDrag(); dragged = false;
        const start = {x:e.clientX, y:e.clientY}, sourceId = port.dataset.output || port.dataset.input, reverse = !!port.dataset.input;
        const source = draft.blocks.find(b => b.id === sourceId);
        port.setPointerCapture(e.pointerId);
        const preview = document.createElementNS('http://www.w3.org/2000/svg','path'); preview.setAttribute('class','flow-wire flow-wire-preview'); wires.append(preview);
        const listeners = new AbortController();
        const clear = () => { preview.remove(); nodes.querySelectorAll('.drop-target').forEach(p=>p.classList.remove('drop-target')); port.onpointermove=null; port.onpointerup=null; port.onpointercancel=null; port.onlostpointercapture=null; listeners.abort(); cleanupDrag=()=>{}; };
        cleanupDrag=clear;
        port.onpointermove = ev => {
          if (!(ev.buttons & 1)) { clear(); return; }
          if (Math.abs(ev.clientX-start.x)+Math.abs(ev.clientY-start.y)>4) dragged=true;
          if (!dragged) return;
          const rect=canvas.getBoundingClientRect(), x=(ev.clientX-rect.left)/zoom, y=(ev.clientY-rect.top)/zoom;
          preview.setAttribute('d',wirePath(portPoint(source,reverse,port.dataset.outputPort),[x,y],reverse));
          nodes.querySelectorAll('.drop-target').forEach(p=>p.classList.remove('drop-target'));
          const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(reverse?'[data-output]':'[data-input]');
          if(target && (target.dataset.input||target.dataset.output)!==sourceId) target.classList.add('drop-target');
        };
        const finish = ev => {
          if(ev.pointerId!==e.pointerId)return;
          const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(reverse?'[data-output]':'[data-input]'); clear();
          if(dragged){ if(target) connect(reverse?target.dataset.output:sourceId,reverse?sourceId:target.dataset.input,reverse?target.dataset.outputPort:port.dataset.outputPort); else say(''); }
        };
        window.addEventListener('pointerup',finish,{capture:true,signal:listeners.signal});
        window.addEventListener('pointercancel',clear,{signal:listeners.signal});
        window.addEventListener('blur',clear,{signal:listeners.signal});
        window.addEventListener('keydown',event=>{if(event.key==='Escape')clear();},{signal:listeners.signal});
        port.onlostpointercapture=clear;
      };
      port.onclick = e => { e.stopPropagation();
        if(dragged){dragged=false;return;}
        if(port.dataset.output){connecting=connecting===port.dataset.output&&connectingPort===port.dataset.outputPort?null:port.dataset.output;connectingPort=port.dataset.outputPort;drawNodes();say('');}
        else if(connecting) connect(connecting,port.dataset.input,connectingPort);
        else say('');
      };
    });
    nodes.querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>loadTemplate(b.dataset.template));
    nodes.querySelector('#flow-start')?.addEventListener('click',()=>{blankChosen=draft;nodes.querySelector('.flow-empty')?.remove();syncStrip();if(!galleryOpen)el.querySelector('#flow-gallery').click();el.querySelector('[data-block]')?.focus();});
    drawWires();drawRunStates();
  }
  // A clicked block goes beside the selected one, or at the first free place in
  // view: never on top of another block.
  const freeSpot = type => {
    const w = NODE_WIDTH, h = 100, gap = 40;
    const hits = (x, y) => draft.blocks.some(o => x < o.x + nodeWidth(o) + gap && x + w + gap > o.x && y < o.y + nodeHeight(o) + gap && y + h + gap > o.y);
    const sel = draft.blocks.find(o => o.id === selection);
    // The visible canvas, less whatever the block palette covers, in canvas units.
    const palette = el.querySelector('.flow-palette:not([hidden])'), vr = viewport.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    const left = Math.max(vr.left, palette ? palette.getBoundingClientRect().right : vr.left);
    const start = sel ? { x: sel.x + nodeWidth(sel) + gap * 2, y: sel.y }
      : { x: Math.max(20, (left + 40 - c.left) / zoom), y: Math.max(20, (vr.top + 40 - c.top) / zoom) };
    for (let row = 0; row < 12; row++) for (let col = 0; col < 8; col++) {
      const x = start.x + col * (w + gap * 2), y = start.y + row * (h + gap);
      if (!hits(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return start;
  };
  const addBlock = (type, point) => {
    if (draft.blocks.length >= FLOW_LIMITS.blocks) return say(`Up to ${FLOW_LIMITS.blocks} blocks per workflow.`);
    const template=type.startsWith('custom:')?custom.find(c=>c.id===type.slice(7))?.block:null;if(template)type=template.type;
    const b={id:crypto.randomUUID(),type,executor:type==='task'?'human':'automatic',review:false,instructions:'',modelId:workflowModels().find(m=>!BLOCKS.find(d=>d.id===type)?.model||(BLOCKS.find(d=>d.id===type).model==='jev')===isJev(m))?.id||'',...(point?{x:point.x,y:point.y}:freeSpot(type)),...BLOCK_DEFAULTS,...(type==='note'?{text:'{{output}}'}:{}),...(template?structuredClone(template):{})};
    draft.blocks.push(b);selection=point?null:b.id;redraw();if(!point)focusNode(b.id);
  };
  el.querySelectorAll('[data-block]').forEach(button => {
    let dragged=false;
    button.onclick=()=>{if(dragged){dragged=false;return;}addBlock(button.dataset.block);};
    button.onpointerdown=e=>{
      if(e.button!==0)return;dragged=false;const start={x:e.clientX,y:e.clientY};let ghost;
      button.setPointerCapture(e.pointerId);
      const clear=()=>{ghost?.remove();viewport.classList.remove('drop-target');button.onpointermove=null;button.onpointerup=null;button.onpointercancel=null;};
      button.onpointermove=ev=>{
        if(Math.abs(ev.clientX-start.x)+Math.abs(ev.clientY-start.y)<5&&!dragged)return;
        dragged=true;if(!ghost){ghost=document.createElement('div');ghost.className='flow-drag-ghost';ghost.textContent=button.textContent;document.body.append(ghost);}
        ghost.style.left=`${ev.clientX+12}px`;ghost.style.top=`${ev.clientY+12}px`;
        const r=viewport.getBoundingClientRect();viewport.classList.toggle('drop-target',ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom);
      };
      button.onpointerup=ev=>{const r=viewport.getBoundingClientRect(),c=canvas.getBoundingClientRect();clear();if(dragged&&ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom)addBlock(button.dataset.block,{x:Math.max(20,(ev.clientX-c.left)/zoom-NODE_WIDTH/2),y:Math.max(20,(ev.clientY-c.top)/zoom-PORT_Y)});};
      button.onpointercancel=clear;
    };
  });
  viewport.onpointerdown=e=>{
    if(e.button!==0||e.target.closest('.flow-node,.flow-wire-hit,.flow-empty button'))return;
    const x=e.clientX,y=e.clientY,left=viewport.scrollLeft,top=viewport.scrollTop;viewport.setPointerCapture(e.pointerId);
    viewport.onpointermove=ev=>{viewport.scrollLeft=left-(ev.clientX-x);viewport.scrollTop=top-(ev.clientY-y);};
    viewport.onpointerup=viewport.onpointercancel=()=>{viewport.onpointermove=null;};
  };
  el.querySelector('#flow-gallery').onclick=()=>{galleryOpen=!galleryOpen||!el.querySelector('.flow-palette').getClientRects().length;if(galleryOpen){navigatorOpen=false;el.querySelector('.flow-navigator').hidden=true;selection=null;optionsOpen=false;redraw();syncHead();}el.querySelector('.flow-palette').hidden=!galleryOpen;el.querySelector('.flow-layout').classList.toggle('gallery-open',galleryOpen);el.querySelector('#flow-gallery').setAttribute('aria-pressed',String(galleryOpen));syncPanelButtons();drawWires();};
  const help=()=>{selection=null;optionsOpen=false;galleryOpen=false;el.querySelector('.flow-palette').hidden=true;el.querySelector('.flow-layout').classList.remove('gallery-open');el.querySelector('#flow-gallery').setAttribute('aria-pressed','false');redraw();syncHead();ctx.helpWorkflow?.(draft);};
  const loadTemplate=async id=>{if(draft.blocks.length&&!await confirmAsk('Replace this draft?',{confirm:'Use template'}))return;draft=templateDraft(id);sourceVersion=draftBase=null;selection=connecting=null;optionsOpen=false;galleryOpen=false;again();};
  el.querySelector('#flow-undo').onclick=()=>{remember();restore(undo,redo);};
  el.querySelector('#flow-redo').onclick=()=>{remember();restore(redo,undo);};
  const setZoom=value=>{const x=(viewport.scrollLeft+viewport.clientWidth/2)/zoom,y=(viewport.scrollTop+viewport.clientHeight/2)/zoom;zoom=Math.max(.001,Math.min(2,value));drawWires();viewport.scrollTo({left:x*zoom-viewport.clientWidth/2,top:y*zoom-viewport.clientHeight/2});drawNodes(true);};
  el.querySelector('#flow-zoom-in').onclick=()=>setZoom(zoom*1.4);
  el.querySelector('#flow-zoom-out').onclick=()=>setZoom(zoom/1.4);
  el.querySelector('#flow-find').onclick=()=>navigatorOpen?closeFinder():openFinder();
  el.querySelector('#flow-navigator-close').onclick=()=>{closeFinder();el.querySelector('#flow-find').focus();};
  el.querySelector('#flow-find-query').oninput=e=>{navigatorQuery=e.target.value;navigatorPage=0;drawFinder();};
  el.querySelector('#flow-find-status').onchange=e=>{navigatorStatus=e.target.value;navigatorPage=0;drawFinder();};
  el.querySelector('.flow-workspace').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();openFinder();}if(e.key==='Escape'&&navigatorOpen){closeFinder();viewport.focus();}});
  el.querySelector('#flow-block-search').oninput=e=>{const q=e.target.value.trim().toLowerCase();el.querySelector('.flow-block-list').scrollTop=0;let shown=0;
    el.querySelectorAll('.flow-palette [data-block]').forEach(b=>{const row=b.closest('.ui-row'),hit=`${b.textContent} ${b.title}`.toLowerCase().includes(q);row.hidden=!hit;if(hit)shown++;});
    el.querySelectorAll('.flow-palette .flow-block-group').forEach(h=>{const any=[...el.querySelectorAll(`.flow-palette [data-block][data-group="${h.dataset.group}"]`)].some(b=>!b.closest('.ui-row').hidden);h.hidden=!any;h.nextElementSibling.hidden=!any;});
    el.querySelector('.flow-block-none').hidden=shown>0;};
  el.querySelector('#flow-pending')?.addEventListener('click',()=>{toggleInspector('review');});
  // Back to the list; unsaved edits are discarded only when confirmed.
  async function leave(then=()=>backPage()) {
    if(isDirty()&&!await confirmAsk('Discard unsaved changes?',{confirm:'Discard',danger:true}))return;
    if(isDirty()){draft=null;sourceVersion=draftBase=null;}
    selection=connecting=null;optionsOpen=galleryOpen=navigatorOpen=false;screen='home';then();(ctx.rerender||(()=>render(el,ctx)))();
  }
  el.querySelector('#flow-reload')?.addEventListener('click',()=>{draft=graphFlow(structuredClone(currentSaved));sourceVersion=signature(currentSaved);draftBase=signature(draft);selection=null;again();});
  el.querySelector('#flow-arrange').onclick = () => showMenu(el.querySelector('#flow-canvas-tools'), ['horizontal','vertical'].map(direction => ({
    label:direction === 'vertical' ? 'Top to bottom' : 'Left to right', checked:(draft.direction || 'horizontal') === direction,
    run:() => { try { draft.blocks = arrangeGraph(draft,direction); draft.direction = direction; el.querySelector('.flow-workspace').dataset.direction = direction; redraw(); viewport.scrollTo({left:0,top:0}); } catch(error) { say(error.message); } },
  })), { align: 'end' });
  el.querySelector('#flow-fit').onclick = () => { zoom = Math.max(.001, Math.min(1, Math.max(100,viewport.clientWidth-(inspectorShown()?inspector.offsetWidth:0)) / Math.max(300, ...draft.blocks.map(b => b.x + nodeWidth(b)+32)), viewport.clientHeight / Math.max(200, ...draft.blocks.map(b => b.y + nodeHeight(b)+16)))); drawWires(); viewport.scrollTo({left:0,top:0});drawNodes(true); };
  el.querySelector('#flow-actual').onclick = e => showMenu(e.currentTarget, [{label:'50%',run:()=>setZoom(.5)},{label:'100%',checked:zoom===1,run:()=>setZoom(1)},{label:'200%',run:()=>setZoom(2)},'-',{label:'Fit to view',run:()=>el.querySelector('#flow-fit').click()},...(selection?[{label:'Centre selection',run:()=>focusNode(selection)}]:[])], { align:'end' });
  viewport.onkeydown = e => { if (e.key === 'Escape') { connecting = null; drawNodes(); say(''); } };
  // Delete or Backspace removes the selected block, as on any canvas; undo
  // brings it back. Listened for on the page, since selecting a block redraws
  // the canvas and focus falls back to the page.
  blockKeys?.abort(); blockKeys = new AbortController();
  document.addEventListener('keydown', e => {
    if (!el.isConnected) { blockKeys.abort(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection && !e.target.closest?.('input,textarea,select,[contenteditable],dialog,.menu') && !document.querySelector('dialog[open]')) {
      const id = selection; if (!draft.blocks.some(n => n.id === id)) return;
      e.preventDefault(); remember();
      draft.blocks = draft.blocks.filter(n => n.id !== id); draft.edges = draft.edges.filter(x => x.from !== id && x.to !== id);
      selection = connecting = null; redraw(); syncHead(); viewport.focus({ preventScroll: true });
    }
  }, { signal: blockKeys.signal });
  const save = (message='') => { if(signature(get().workflows?.find(f=>f.id===draft.id))!==sourceVersion)throw new Error('The saved workflow changed. Load saved changes before saving.');validateFlow(draft,{draft:true}); if (draft.enabled && !draft.cron) throw new Error('Enter a cron schedule before enabling it.'); update(s => { const current=s.workflows?.find(f=>f.id===draft.id);for(const key of ['lastSlot','scheduleCheckedSlot','scheduledFor','scheduleAt','scheduleStatus','scheduleError'])if(current?.[key]!=null)draft[key]=current[key];s.workflows = [...(s.workflows || []).filter(f => f.id !== draft.id), structuredClone(draft)]; (s.workflowVersions ||= {})[draft.id] = recordVersion(s.workflowVersions[draft.id] || [], draft, { author: get().settings?.reviewerName || 'You', message }).versions; return s; });sourceVersion=signature(draft);draftBase=signature(draft); };
  const importFlow=()=>{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>FLOW_LIMITS.importBytes)throw new Error('Workflow files must be under 10 MB.');const data=JSON.parse(await file.text());if(data.format!=='lykos-workflow-1')throw new Error('Choose a Lykos workflow file.');const next=graphFlow({...data.workflow,id:crypto.randomUUID(),enabled:false});validateFlow(next,{draft:true});if(draft.blocks.length&&!await confirmAsk('Replace this draft?',{confirm:'Import'}))return;draft=next;sourceVersion=draftBase=null;selection=null;again();}catch(err){say(err.message);}};input.click();};
  // The title bar's commands reach this canvas through `editor` (page() declares them; the shell binds each by id on every draw).
  editor = {
    leave, help,
    toggle: mode => toggleInspector(mode),
    // A save that changes the structure becomes a version; its one-line message is optional.
    save: async () => { try {
      validateFlow(draft,{draft:true});
      const last=(get().workflowVersions?.[draft.id]||[]).at(-1);let message='';
      if(!last||structureKey(last.flow)!==structureKey(draft)){const answer=await ask('Version message',{placeholder:last?describeDiff(diffFlows(last.flow,draft)):'Created',confirm:'Save'});if(answer===null)return;message=answer;}
      save(message); again(); say(`Saved as version ${(get().workflowVersions?.[draft.id]||[]).at(-1)?.n||1}`); } catch (e) { say(e.message); } },
    run: async () => { const runningFlowId=draft.id; try { save(); syncHead(); if(!await (await import('../lib/flow-preview.mjs')).confirmFlow(draft))return; say('Running workflow…'); const result=await runFlow(runningFlowId);if(draft?.id!==runningFlowId||!el.isConnected)return;optionsOpen=true;selection=null;panelMode=result.status==='waiting'?'review':'runs'; again(); say(result.status==='waiting'?'Waiting for your input':'Workflow completed'); } catch (e) {if(draft?.id!==runningFlowId||!el.isConnected)return;optionsOpen=true;panelMode='runs';selection=null;again();say(e.message); } },
    stop: () => { const r=(get().workflowRuns||[]).find(r=>r.flowId===draft.id&&!r.parentRunId&&r.status==='running'); if(r){stopFlow(r.id);say('Stopping after active requests finish…');syncHead();} },
    rename: async () => { const name=await askText('Rename workflow',{value:draft.name||'',placeholder:'Untitled workflow',confirm:'Rename'}); if(name==null)return; draft.name=name.trim(); remember(); shell?.chrome?.(); },
    templates: anchor => showMenu(menuAnchor(anchor),templateItems(loadTemplate),{className:'flow-template-menu',align:'end'}),
    // Required checks before a run, as a list: each passes or names what to fix.
    check: anchor => showMenu(menuAnchor(anchor),[{heading:'Checks before running'},...preflight(draft).map(c=>({label:c.ok?c.label:c.blocked?`${c.label}: not checked`:c.error,icon:c.ok?'check':'warn',disabled:true}))],{align:'end',minWidth:260}),
    duplicate: () => { draft={...structuredClone(draft),id:crypto.randomUUID(),name:`${draft.name||'Workflow'} copy`,enabled:false};sourceVersion=draftBase=null;selection=null;goPage('editor',{flowId:draft.id,runId:null});(ctx.rerender||again)(); },
    exportFlow: () => saveFile(JSON.stringify({format:'lykos-workflow-1',workflow:{...draft,enabled:false}},null,2),'workflow.json','application/json'),
    importFlow,
    remove: async () => { if(!await confirmAsk('Delete this workflow?',{confirm:'Delete',danger:true}))return; update(s => { s.workflows = (s.workflows || []).filter(f => f.id !== draft.id); if (s.workflowVersions) delete s.workflowVersions[draft.id]; return s; }); draft = null;sourceVersion=draftBase=null;selection = null;optionsOpen=false;screen='home';goPage('home');(ctx.rerender||(()=>render(el,ctx)))(); },
  };
  drawNodes(); drawInspector();
  if(camera){viewport.scrollTo({left:camera.left,top:camera.top});drawNodes(true);}
  let canvasFrame=0,stateFrame=0;
  const refreshCanvas=()=>{if(!canvasFrame)canvasFrame=requestAnimationFrame(()=>{canvasFrame=0;if(!el.querySelector('.flow-node:active'))drawNodes(true);});};
  viewport.onscroll=refreshCanvas;
  // the canvas draws only the blocks in view: a viewport that changes size draws the ones that came into view (a drawing surface, not a row of controls)
  const observer=new ResizeObserver(refreshCanvas);observer.observe(viewport);
  const observed=signature(get().workflows?.find(f=>f.id===draft.id));
  let alive=true;
  const off=subscribe(()=>{if(!stateFrame)stateFrame=requestAnimationFrame(()=>{stateFrame=0;if(!alive||!el.isConnected)return;drawRunStates();if(shownMode().mode==='options'&&body.querySelector('#flow-schedule')?.open)previewSchedule();if(signature(get().workflows?.find(f=>f.id===draft.id))!==observed)again();});});
  const renderedId=draft.id;
  unsubscribe=()=>{if(viewport.isConnected)cameraPositions.set(renderedId,{left:viewport.scrollLeft,top:viewport.scrollTop,zoom});alive=false;off();observer.disconnect();cancelAnimationFrame(canvasFrame);cancelAnimationFrame(stateFrame);clearTimeout(feedbackTimer);};
}
