import { get, update, projects, subscribe } from '../store.mjs';
import { AVAILABILITY, toolDefs } from './agent-tools.mjs';
import { columnsOf } from './templates.mjs';
import { executorFor } from './agent.mjs';
import { projectOverview } from './project-memory.mjs';
import { notify } from './notifications.mjs';
import { runFlow, validateFlow } from './flow-runner.mjs';
import { proposeChanges } from './changes.mjs';
import { addFileNote } from './file-notes.mjs';
import { runQuery, describeData, resultText } from './project-query.mjs';
import { currentSpec, sourceLine, builtinOutputs } from './output-spec.mjs';
import { renderOutput, outputText } from './output-render.mjs';
import { proposeOutput } from './output-proposals.mjs';
import { current, activeFolder } from './projects.mjs';
import * as reads from './assist-reads.mjs';
import { index as docIndex } from './doctext.mjs';
import { paperOf } from './change-ops.mjs';
import { retractionStatusTool } from './integrity.mjs';
import { openAccessStatusTool } from './open-access.mjs';
import { proposeSubmission } from './submission-proposals.mjs';
// The review's state by part, the same reads the in-app assistant has (lib/assist-reads.mjs), under the same names.
const STATE_READS = { screening_status: reads.screeningStatus, screening_record: reads.screeningRecord, similar_records: reads.similarRecords, cell_context: reads.cellContext, appraisal_status: reads.appraisalStatus,
  analysis_result: reads.analysisResult, analysis_inputs: reads.analysisInputs, manuscript_outline: reads.manuscriptOutline, manuscript_read: reads.manuscriptRead, check_manuscript: reads.checkManuscriptTool, report_status: reads.reportStatus,
  search_history: reads.searchHistory, translate_query: reads.translateQueryTool, folder_plan: reads.folderPlan, missed_values: (s, a) => reads.missedValuesTool(s, a, { index: docIndex }),
  retraction_status: (s, a) => retractionStatusTool(s, a, paperOf), open_access_status: (s, a) => openAccessStatusTool(s, a, paperOf) };
let connection=null,timer=null,heartbeat=null,busy=false,lastError='';
const extra=(name,description,properties={},required=[],readOnlyHint=true)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint,destructiveHint:false}});
export function mcpTools(){return [...toolDefs({project:true,changes:true,propose:false,opDocs:true}).filter(d=>d.function.name!=='finish').map(d=>({name:d.function.name,description:d.function.description,inputSchema:d.function.parameters,annotations:{readOnlyHint:d.function.name!=='propose_changes',destructiveHint:false}})),
 extra('project_overview','Read the connected project overview.'),
 extra('list_workflows','List saved workflows and recent runs.'),
 extra('run_workflow','Run a saved workflow in the connected app.',{id:{type:'string'}},['id'],false),
 extra('save_workflow','Propose a new or edited workflow for the user to review. Each task may be automatic, AI assigned, or human assigned.',{flow:{type:'object'}},['flow'],false),
 extra('list_file_notes','Read saved file notes and edit TODOs.'),
 extra('add_file_note','Save a note for a file selection.',{text:{type:'string'},path:{type:'string'},quote:{type:'string'},todo:{type:'boolean'}},['text','path'],false),
 extra('list_notifications','Read job notifications.'),
 extra('describe_data','Tables, columns, collections and the query syntax of the open project.',{template:{type:'string'}}),
 extra('query_project','Rows and counts from the open project (see describe_data for the syntax).',{query:{type:'object'}},['query']),
 extra('list_outputs','Saved tables and figures; with id, the spec and its rendered rows.',{id:{type:'string'}}),
 extra('propose_output','Propose a new or changed table or figure (an output spec). It waits in the app with a live preview until the person saves it.',{spec:{type:'object'},message:{type:'string'}},['spec'],false),
 extra('review_state','Read part of the open review: what names the read; the other fields are its own (paper, stage, column, outcome, block, query).',{what:{type:'string',enum:Object.keys(STATE_READS)},paper:{type:'string'},stage:{type:'string',enum:['ta','ft']},column:{type:'string'},template:{type:'string'},outcome:{type:'string'},measure:{type:'string'},block:{type:'string'},section:{type:'string'},query:{type:'string'},target:{type:'string'},limit:{type:'integer'},offset:{type:'integer'},criteria:{type:'boolean'}},['what']),
 extra('propose_value','Propose one extraction cell for a paper. It waits in Extraction until the person accepts it. Quotes must be verbatim from the paper.',{paper:{type:'string',description:'Record id or label'},column:{type:'string',description:'Column id or label'},value:{type:'string'},availability:{type:'string',enum:AVAILABILITY},rationale:{type:'string'},evidence:{type:'array',items:{type:'object',properties:{kind:{type:'string',enum:['text','file']},doc_id:{type:'string'},quote:{type:'string'},page:{type:'integer'},path:{type:'string'}}}},template:{type:'string'}},['paper','column','value','availability','evidence'],false),
 // One journal event (or a new submission) from a letter the person gave; it waits in Proposals and never sets a follow-up date (lib/submission-proposals.mjs).
 extra('propose_submission','Propose one journal event (attemptId) or a new submission (journal) from a letter the person gave, quoted as source. It waits in Proposals.',{attemptId:{type:'string'},journal:{type:'string'},event:{type:'object',properties:{kind:{type:'string',enum:['planned','submitted','revise','revised','accepted','rejected','withdrawn','published']},at:{type:'string',description:'YYYY-MM-DD as the source states it'},due:{type:'string'},desk:{type:'boolean'},doi:{type:'string'},note:{type:'string'},letter:{type:'string'}},required:['kind','at'],additionalProperties:false},source:{type:'string'}},['event','source'],false),
 ];}
// Which project this window has open, for the MCP server to check calls
// against (tools/mcp/target.mjs): a desktop folder by its path, a browser
// folder by its name, a project in the app's storage by kind only.
export function openProject(){const e=current(),f=activeFolder();return {id:projects().current,kind:f?.kind||e.kind||'local',name:get().project?.name||e.name||'',...(f?.kind==='path'?{path:f.root}:{}),...(f?.kind==='handle'?{folder:f.name}:{})};}
export const mcpStatus=()=>({connected:!!connection,error:lastError,url:connection?.url||''});
export async function disconnectMcp(){const c=connection;connection=null;clearTimeout(timer);clearInterval(heartbeat);if(c)try{await request(c,'/disconnect',{session:c.session});}catch{} }
async function request(c,path,body){const res=await fetch(c.url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${c.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const data=await res.json();if(!res.ok)throw new Error(data.error||`Bridge error ${res.status}`);return data;}
export async function connectMcp(url,token){if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error('Use the local bridge address, such as http://127.0.0.1:8750.');if(token.length<32)throw new Error('Paste the pairing token from the bridge configuration.');await disconnectMcp();const c={url,token,session:crypto.randomUUID(),project:projects().current};await request(c,'/connect',{session:c.session,tools:mcpTools(),project:openProject()});connection=c;lastError='';heartbeat=setInterval(()=>request(c,'/heartbeat',{session:c.session}).catch(()=>{}),5000);poll();}
async function execute(command){const a=command.arguments||{},s=get();
 switch(command.name){
 case 'project_overview':return projectOverview(s);
 case 'list_workflows':return {workflows:s.workflows||[],runs:(s.workflowRuns||[]).slice(0,20)};
 case 'run_workflow':return runFlow(a.id);
 case 'save_workflow':{validateFlow(a.flow);return proposeChanges({summary:`Workflow: ${a.flow.name}`,changes:[{op:'save_workflow',flow:a.flow}]},{view:'workflows',model:'External MCP'});}
 case 'list_file_notes':return s.fileNotes||[];
 case 'add_file_note':{if(typeof a.text!=='string'||typeof a.path!=='string')throw new Error('Text and path are required.');let note;update(st=>{note=addFileNote(st,{text:a.text,source:{path:a.path,label:a.path.split('/').pop()},anchor:{kind:'text',quote:String(a.quote||''),prefix:'',suffix:'',start:0,end:String(a.quote||'').length},todo:a.todo===true});return st;});return note;}
 case 'list_notifications':return s.notifications||[];
 case 'describe_data':return describeData(s,{template:a.template||null});
 case 'query_project':return resultText(runQuery(s,a.query||{},{limit:200}));
 case 'list_outputs':{const all=[...(s.outputs||[]),...builtinOutputs(s)];if(a.id){const o=all.find(x=>x.id===a.id);if(!o)throw new Error(`No output "${a.id}".`);return `${JSON.stringify(currentSpec(o))}\n\n${outputText(renderOutput(s,currentSpec(o)))}`;}return all.map(o=>{const sp=currentSpec(o);return `${o.id}\t${sp.title}\t${sp.kind==='chart'?sp.chart.type:'table'}\t${sourceLine(sp,s)}\t${o.builtin?'built in':`v${o.versions.at(-1).n}`}`;}).join('\n');}
 case 'propose_submission':{const e=proposeSubmission(s,a,{model:'External MCP'});return `Proposed ${e.items[0]?.label||'a submission event'}. It waits in Proposals until the person accepts it.`;}
 case 'propose_output':{const r=proposeOutput(a.spec,{model:'External MCP',message:String(a.message||'').slice(0,160),author:'MCP'});if(!r.ok)throw new Error(`Not proposed. Fix: ${r.errors.join(' | ')}`);return `Proposed ${r.spec.title} (${r.id}): ${r.rows} rows${r.groups>1?` in ${r.groups} groups`:''}. It waits in the app until the person saves it.${r.notes.length?`\nnotes: ${r.notes.join(' | ')}`:''}`;}
 case 'review_state':{const fn=STATE_READS[a.what];if(!fn)throw new Error(`what must be one of ${Object.keys(STATE_READS).join(', ')}`);const {what:_w,...rest}=a;return await fn(s,rest);}
 case 'propose_value':{const key=String(a.paper||'').trim().toLowerCase();const paper=(s.papers||[]).find(p=>p.id===a.paper)||(s.papers||[]).find(p=>String(p.label||'').toLowerCase()===key);if(!paper)throw new Error(`No record "${a.paper}". Use list_documents or read_project library for ids.`);
  const exec=executorFor({paperId:paper.id,columns:columnsOf(a.template||'default'),model:'External MCP',runId:null,mode:'chat'});const {paper:_p,template:_t,...cell}=a;const r=await exec('propose_cell',JSON.stringify(cell));if(typeof r.content==='string'&&r.content.startsWith('error:'))throw new Error(r.content);return r.content;}
 default:{const exec=executorFor({paperId:null,columns:[],model:'External MCP',runId:null,mode:'chat'});const r=await exec(command.name,JSON.stringify(a));if(typeof r.content==='string'&&r.content.startsWith('error:'))throw new Error(r.content);return r.content;}
 }}
async function poll(){const c=connection;if(!c||busy)return;busy=true;try{if(projects().current!==c.project){await disconnectMcp();return;}const {commands}=await request(c,`/poll?session=${encodeURIComponent(c.session)}`);
 for(const command of commands){if(connection!==c)break;let result;try{const out=await execute(command);result={content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};}catch(err){result={isError:true,content:[{type:'text',text:err.message}]};}
 if(connection===c){update(s=>{s.mcpActivity=[{at:new Date().toISOString(),tool:command.name,failed:!!result.isError},...(s.mcpActivity||[])].slice(0,100);if(result.isError||!mcpTools().find(t=>t.name===command.name)?.annotations?.readOnlyHint)notify(s,{title:`MCP: ${command.name}${result.isError?' failed':''}`,detail:result.isError?result.content[0].text:'',view:'mcp',tone:result.isError?'error':'info'});return s;});await request(c,'/result',{session:c.session,id:command.id,result});}
 }
 }catch(err){lastError=err.message;await disconnectMcp();}finally{busy=false;if(connection)timer=setTimeout(poll,700);}}
subscribe(()=>{if(connection&&projects().current!==connection.project)disconnectMcp();});
