import { arrangeGraph } from './flow-graph.mjs';
import { libraryIndex } from './search-library.mjs';
import { toRis, toBibtex, toCsv } from './bib-export.mjs';
import { FLOW_LIMITS } from './flow-limits.mjs';
import { SOURCES } from './sources.mjs';
import { SITES } from './site-search.mjs';
import { inHostedTab } from './native.mjs';

// `desktop`: a block or template that reads Zotero's local API, which a browser tab on https cannot reach (lib/native.mjs).
// The palette and the template menus list what can run here; a saved workflow that holds one still opens and says why it fails.
export const usableHere = list => inHostedTab() ? list.filter(x => !x.desktop) : list;
export const BLOCKS = [
  {id:'team',label:'Model team',group:'Research',icon:'models',description:'Delegate research to a saved model team and review its combined answer.',fields:['teamId','instructions']},
  {id:'http',label:'Fetch JSON',group:'Sources',icon:'globe',description:'Read a public JSON endpoint and map its records. GET only; up to ten pages.',fields:['url','itemsPath','titlePath','idPath','abstractPath','yearPath','pages','pageParam']},
  {id:'condition',label:'If / else',group:'Routing',icon:'branch',description:'Route matching records and other records to separate branches.',fields:['query','matchField','matchMode','yearFrom','yearTo','requireField']},
  {id:'subworkflow',label:'Run workflow',group:'Routing',icon:'workflow',description:'Run a saved workflow with these inputs; wait for its output and approvals.',fields:['workflowId']},
  {id:'batch',label:'For each batch',group:'Routing',icon:'batch',description:'Run a saved workflow for each batch, preserving completed iterations.',fields:['workflowId','batchSize']},
  {id:'input',label:'Workflow input',group:'Sources',icon:'import',description:'Receive records and text from a calling workflow.',fields:[]},
  {id:'output',label:'Workflow output',group:'Actions',icon:'export',description:'Return these records and text to the calling workflow.',fields:[]},
  {id:'wait',label:'Wait',group:'Routing',icon:'clock',description:'Delay this branch before continuing.',fields:['waitSeconds']},
  {id:'merge',label:'Merge branches',group:'Routing',icon:'merge',description:'Wait for every connected branch; combine records and preserve labelled outputs.',fields:[]},
  {id:'fanout',label:'Parallel branches',group:'Routing',icon:'fanout',description:'Send the same records to independent connected branches.',fields:[]},
  {id:'criteria',label:'Structure criteria',group:'Research',icon:'criteria-edit',model:'text',description:'Turn protocol prose into criteria for human approval.',fields:['text']},
  {id:'screen_pass',label:'Screening pass',group:'Research',icon:'criteria-check',model:'jev',description:'One independent Jev title and abstract pass.',fields:['passNumber']},
  {id:'consensus',label:'Three-pass consensus',group:'Routing',icon:'consensus',description:'Combine three independent passes into screening proposals.',fields:[]},
  {id:'screening',label:'Screen title & abstract',group:'Research',icon:'screening',model:'jev',description:'Three Jev passes, consensus and the protocol language rule. Proposals only.',fields:[]},
  {id:'dual_review',label:'Dual-reviewer checkpoint',group:'Research',icon:'scale',description:'Wait for two human reviews and a resolved decision; pass included records.',fields:['stage']},
  {id:'extraction',label:'Extract from abstracts',group:'Research',icon:'extract',model:'text',description:'Propose field values with supporting quotes.',fields:[]},
  {id:'prisma',label:'PRISMA counts',group:'Research',icon:'flow',description:'Export recorded counts without filling unknown totals.',fields:[]},
  {id:'screening_sheet',label:'Screening sheet',group:'Actions',icon:'table',description:'Export records, reviewer decisions and model proposals to CSV.',fields:[]},
  {id:'library',label:'Library & collections',group:'Sources',icon:'library',description:'Read all library records or one collection.',fields:['collection']},
  {id:'search',label:'Search literature',group:'Sources',icon:'literature',description:'Search PubMed, Europe PMC, Crossref, OpenAlex or ClinicalTrials.gov. Choose a sample or retrieve successive pages up to a declared ceiling.',fields:['source','query','acquisition','limit','maxRecords']},
  {id:'zotero',desktop:true,label:'Zotero',group:'Sources',icon:'reference-source',description:'Read records from Zotero’s local API.',fields:['limit']},
  {id:'enrich',label:'Crossref metadata',group:'Enrichment',icon:'file-plus',description:'Fill missing metadata by DOI on the passing records.',fields:[]},
  {id:'abstracts',label:'Retrieve abstracts',group:'Enrichment',icon:'summarize',description:'Fill missing abstracts from Europe PMC and PubMed.',fields:[]},
  {id:'filter',label:'Filter records',group:'Records',icon:'filter',description:'Filter by text, year and available fields.',fields:['query','matchField','matchMode','yearFrom','yearTo','requireField']},
  {id:'dedupe',label:'Remove duplicates',group:'Records',icon:'dedupe',description:'Match exact DOI, PMID or record identifiers.',fields:[]},
  {id:'new_records',label:'Exclude library records',group:'Records',icon:'library-minus',description:'Pass only records not already in the library.',fields:[]},
  {id:'sort',label:'Sort records',group:'Records',icon:'sort',description:'Order incoming records by year, title or journal.',fields:['sortBy','direction']},
  {id:'limit',label:'Limit records',group:'Records',icon:'limit',description:'Pass the first records in the current order.',fields:['limit']},
  {id:'task',label:'AI or human task',group:'Actions',icon:'assign',description:'Assign work to a configured model or a person.',fields:['instructions']},
  {id:'collect',label:'Save to library',group:'Actions',icon:'library-add',description:'Save new records to the library or a collection, skipping duplicates.',fields:['collection']},
  {id:'note',label:'Save note',group:'Actions',icon:'note',description:'Save text or a previous task’s output in Notes.',fields:['text']},
  {id:'todo',label:'Create task',group:'Actions',icon:'tasks',description:'Create a project task.',fields:['text']},
  {id:'notify',label:'Notify in app',group:'Actions',icon:'bell',description:'Add a notification to this project.',fields:['text']},
  {id:'export',label:'Export references',group:'Actions',icon:'download-references',description:'Keep a downloadable CSV, RIS or BibTeX file with the run.',fields:['format']},
];
export const FIELD_OPTIONS = {
  acquisition:[['sample','Sample'],['all','All available pages, up to ceiling']],
  passNumber:[['1','Pass 1 · eligibility'],['2','Pass 2 · evidence'],['3','Pass 3 · cross-check']],
  stage:[['ta','Title and abstract'],['ft','Full text']],
  matchField:[['all','Title & abstract'],['title','Title'],['abstract','Abstract'],['journal','Journal'],['authors','Authors']],
  matchMode:[['contains','Contains'],['excludes','Does not contain']],
  requireField:[['','Any records'],['abstract','Has abstract'],['doi','Has DOI'],['pdf','Has PDF'],['missingAbstract','Missing abstract'],['missingDoi','Missing DOI']],
  sortBy:[['year','Year'],['title','Title'],['journal','Journal']],
  direction:[['desc','Descending'],['asc','Ascending']],
  format:[['csv','CSV'],['ris','RIS'],['bib','BibTeX']],
};
export const FIELD_LABELS = {teamId:'Model team',url:'JSON endpoint URL',itemsPath:'Records path',titlePath:'Title field',idPath:'Identifier field',abstractPath:'Abstract field',yearPath:'Year field',pages:'Pages (1–10)',pageParam:'Page parameter',workflowId:'Workflow',batchSize:'Records per batch',waitSeconds:'Seconds (1–3600)',passNumber:'Independent pass',stage:'Stage',collection:'Collection',source:'Source',query:'Search text',acquisition:'Retrieval scope',maxRecords:'Retrieval ceiling (1–100,000)',instructions:'Instructions',text:'Text',limit:'Record limit (1–100)',matchField:'Search in',matchMode:'Match',yearFrom:'From year',yearTo:'Through year',requireField:'Availability',sortBy:'Sort by',direction:'Order',format:'Format'};
export const BLOCK_DEFAULTS = {url:'',itemsPath:'',titlePath:'title',idPath:'id',abstractPath:'abstract',yearPath:'year',pages:1,pageParam:'page',batchSize:10,waitSeconds:5,passNumber:'1',stage:'ta',source:'pubmed',acquisition:'sample',maxRecords:10000,query:'',text:'',collection:'',limit:100,matchField:'all',matchMode:'contains',yearFrom:'',yearTo:'',requireField:'',sortBy:'year',direction:'desc',format:'csv'};
/**
 * How a block's Settings draw each field: the one table the inspector's one renderer reads (views/workflow-inspector.mjs), so the type of a
 * block decides only which rows exist. text: a one-line field; url: a web address; number: a text field that takes digits (inputmode decimal,
 * never type=number); choice: a select of FIELD_OPTIONS; long: a text area; team, workflow, collection, source: a select or picker of the
 * project's own model teams, saved workflows, collections and search sources.
 */
export const FIELD_CONTROLS = {
  teamId:'team', url:'url', itemsPath:'text', titlePath:'text', idPath:'text', abstractPath:'text', yearPath:'text', pages:'number', pageParam:'text',
  workflowId:'workflow', batchSize:'number', waitSeconds:'number', passNumber:'choice', stage:'choice', collection:'collection', source:'source',
  query:'long', acquisition:'choice', maxRecords:'number', instructions:'long', text:'long', limit:'number', matchField:'choice', matchMode:'choice',
  yearFrom:'number', yearTo:'number', requireField:'choice', sortBy:'choice', direction:'choice', format:'choice',
};
export const AGENT_TOOLS=[['search','Search literature'],['abstracts','Retrieve abstracts']];

// The assistant reads the same field values as the editor. Keep shared fields
// once per contract: repeating their schemas on every block wastes context and
// makes labels such as "All available pages" look like accepted JSON values.
const FIELD_CONSTRAINTS = {
  source:{enum:[...SOURCES,...SITES].map(s=>s.id),labels:Object.fromEntries([...SOURCES,...SITES].map(s=>[s.id,s.name]))},
  acquisition:{description:'sample retrieves at most limit records. all retrieves successive pages up to maxRecords. Use these exact values; pages is not a retrieval scope.'},
  maxRecords:{type:'integer',minimum:1,maximum:100000},
  limit:{type:'integer',minimum:1,maximum:100},
  pages:{type:'integer',minimum:1,maximum:10,description:'Page count for http blocks only.'},
  batchSize:{type:'integer',minimum:1,maximum:100},
  waitSeconds:{type:'number',minimum:1,maximum:3600},
  yearFrom:{type:['integer','string'],minimum:1000,maximum:9999,pattern:'^(?:[1-9][0-9]{3})?$'},
  yearTo:{type:['integer','string'],minimum:1000,maximum:9999,pattern:'^(?:[1-9][0-9]{3})?$'},
  collection:{description:'Existing collection ID, or empty for the whole library.'},
  workflowId:{description:'Existing saved workflow ID; child needs one input and one output block.'},
  teamId:{description:'Existing saved model-team ID.'},
  url:{description:'Public http(s) JSON endpoint; GET only.'},
};
export const FIELD_SCHEMAS = Object.fromEntries([...new Set(BLOCKS.flatMap(b=>b.fields))].map(field=>[field,{
  type:'string',
  ...(field in BLOCK_DEFAULTS?{default:BLOCK_DEFAULTS[field]}:{}),
  ...(FIELD_OPTIONS[field]?{enum:FIELD_OPTIONS[field].map(([value])=>value)}:{}),
  ...FIELD_CONSTRAINTS[field],
}]));
const BLOCK_REQUIREMENTS = {
  team:{required:['teamId','instructions']},
  http:{required:['url']},
  subworkflow:{required:['workflowId']},
  batch:{required:['workflowId']},
  criteria:{required:['text','modelId']},
  screen_pass:{required:['modelId']},
  screening:{required:['modelId']},
  extraction:{required:['modelId']},
  search:{whenAutomaticRequired:['query']},
  task:{required:['instructions'],executor:['ai','human']},
  note:{whenAutomaticRequired:['text']},
  todo:{whenAutomaticRequired:['text']},
  notify:{whenAutomaticRequired:['text']},
};
const WORKFLOW_CONTRACT = {
  fieldSchemas:FIELD_SCHEMAS,
  blockTypes:usableHere(BLOCKS).map(({id,label,description,fields,model})=>({id,label,description,fields,...(model?{model}:{}),...BLOCK_REQUIREMENTS[id]})),
  blockFields:{
    id:{type:'string',description:'Unique within this flow.'},label:{type:'string'},
    x:{type:'number'},y:{type:'number'},
    executor:{type:'string',enum:['automatic','ai','human'],default:'automatic'},
    instructions:{type:'string',description:'Assignment for ai or human execution.'},
    modelId:{type:'string',description:'Configured model ID. Required for executor ai and blocks with a model requirement.'},
    review:{type:'boolean',default:false},retries:{type:'integer',minimum:0,maximum:3,default:0},
    onError:{type:'string',enum:['stop','continue'],default:'stop'},
    tools:{type:'array',items:{type:'string',enum:AGENT_TOOLS.map(([id])=>id)},default:[],description:'Explicitly enabled tools for executor ai.'},
    maxToolCalls:{type:'integer',minimum:0,maximum:5,default:3},
  },
  flowFields:{
    id:{type:'string'},name:{type:'string',minLength:1},
    blocks:{type:'array',minItems:1,maxItems:FLOW_LIMITS.blocks},edges:{type:'array',maxItems:FLOW_LIMITS.edges},
    cron:{type:'string',default:'',description:'Five local-time cron fields, or empty for manual runs.'},
    enabled:{type:'boolean',default:false},protected:{type:'boolean',default:false},
    concurrency:{type:'integer',minimum:1,maximum:8,default:3},
    keepRuns:{type:'integer',enum:[10,25,50,100],default:25},
    maxAgentConcurrency:{type:'integer',minimum:1,maximum:16,default:4},
    maxAgentCalls:{type:'integer',minimum:1,maximum:10000,default:1000},
    catchUp:{type:'string',enum:['skip','latest'],default:'skip'},
  },
  edgeFields:{from:{type:'string'},to:{type:'string'},port:{type:'string',enum:['main','match','other','error'],default:'main'}},
  rules:[
    'Use blockTypes.id as block.type; fields are described once in fieldSchemas. Enum values are case-sensitive machine values, not labels. Omit unused optional fields; defaults apply.',
    'Save one workflow per save_workflow call. Each block needs a unique id; edges use those ids. Positions are optional and can be arranged automatically.',
    'Keep enabled false unless a schedule was requested; enabling requires cron. Human approval is required to accept a proposal or pass a human gate.',
    'Source blocks (library, search, zotero, input, http) have no incoming edges. Record-processing blocks need an input. Graphs cannot contain cycles.',
    'Independent branches run up to concurrency; merge waits for every connected branch and preserves labelled text. Only condition has match/other ports. error routes handled failures with onError continue.',
    'Research blocks and team, http, condition, merge, input, output, subworkflow, batch, wait use the automatic executor. task requires ai or human. AI assignments require instructions, query or text and a text modelId; model jev blocks need a Jev model.',
    'Search sources wos and scopus use automatic and wait for the person to search their signed-in session and supply an export. Acquisition settings apply to API sources.',
    'review true pauses before output passes or changes apply. Human tasks always pause for a person; team synthesis always requires approval. retries handles temporary failures only. text supports {{count}} and {{output}}; automatic text needs an incoming connection for output.',
    'Consensus requires three directly connected screen_pass blocks with distinct passNumber values. For filters, yearFrom must not exceed yearTo.',
  ],
};
export function workflowContract() { return WORKFLOW_CONTRACT; }
export function filterRecords(records,b) {
  const q=String(b.query||'').trim().toLowerCase();
  return records.filter(r=>{
    const value=b.matchField&&b.matchField!=='all'?r[b.matchField]:`${r.title||''} ${r.abstract||''}`;
    const hit=String(value||'').toLowerCase().includes(q);
    if(q&&(b.matchMode==='excludes'?hit:!hit))return false;
    const y=Number(r.year);if((b.yearFrom&&(!y||y<Number(b.yearFrom)))||(b.yearTo&&(!y||y>Number(b.yearTo))))return false;
    const f=b.requireField;if(f==='missingAbstract')return !r.abstract;if(f==='missingDoi')return !r.doi;
    return !f||!!r[f];
  });
}
export function uniqueRecords(records) {
  const index=libraryIndex([]), out=[];
  for(const r of records){const found=index.find(r);if(found){index.add({...r,id:found.id,key:found.key});continue;}out.push(r);index.add(r);}return out;
}
export function sortFlowRecords(records,b) {
  const field=b.sortBy||'year',direction=b.direction==='asc'?1:-1;
  return [...records].sort((a,c)=>{
    const x=a[field],y=c[field];if(!x)return y?1:0;if(!y)return -1;
    return direction*(field==='year'?Number(x)-Number(y):String(x).localeCompare(String(y),undefined,{numeric:true}));
  });
}
export function exportFlowRecords(records,format='csv') {
  return format==='ris'?toRis(records):format==='bib'?toBibtex(records):toCsv(records);
}
export const FLOW_TEMPLATES = [
  {id:'agent-team',group:'Review',purpose:'Three assistants research in parallel; you approve the synthesis',name:'Parallel research team',detail:'Three agents → merge → synthesis → approval → note',blocks:[
    {type:'library'},{type:'limit',limit:20},{type:'fanout'},
    {type:'task',label:'Evidence analyst',executor:'ai',instructions:'Summarize the supplied evidence. Cite record IDs, distinguish reported findings from interpretation, and identify missing evidence.'},
    {type:'task',label:'Methods reviewer',executor:'ai',instructions:'Assess study design, limitations and possible bias from the supplied records. Cite record IDs; do not infer unreported methods.'},
    {type:'task',label:'Critical reviewer',executor:'ai',instructions:'Identify contradictory findings, weak claims and gaps in the supplied evidence. Cite record IDs and separate uncertainty from established findings.'},
    {type:'merge'},
    {type:'task',label:'Synthesis editor',executor:'ai',review:true,instructions:'Synthesize the labelled agent outputs into a concise research brief. Preserve disagreements and record references, and do not invent evidence. The result requires human approval.'},
    {type:'note',text:'{{output}}'}],links:[[0,1],[1,2],[2,3],[2,4],[2,5],[3,6],[4,6],[5,6],[6,7],[7,8]]},
  {id:'review-team',group:'Review',purpose:'Two people review independently, then results merge',name:'Parallel human review',detail:'Two reviewers → merge → reviewed note',blocks:[{type:'library'},
    {type:'task',label:'Reviewer A',executor:'human',instructions:'Review the supplied records and write your assessment.'},
    {type:'task',label:'Reviewer B',executor:'human',instructions:'Independently review the supplied records and write your assessment.'},
    {type:'merge'},{type:'note',text:'{{output}}',review:true}],links:[[0,1],[0,2],[1,3],[2,3],[3,4]]},
  {id:'three-pass-screening',group:'Review',purpose:'Screen the library three times, then reach consensus',name:'Three-pass screening',detail:'Library → three independent passes → consensus → screening sheet',blocks:[{type:'library'},{type:'fanout'},...['1','2','3'].map(passNumber=>({type:'screen_pass',passNumber,label:`Screening pass ${passNumber}`})),{type:'consensus'},{type:'screening_sheet'}],links:[[0,1],[1,2],[1,3],[1,4],[2,5],[3,5],[4,5],[5,6]]},
  {id:'dual-review-extraction',group:'Review',purpose:'Dual review and extraction proposals for included studies',name:'Dual review and extraction',detail:'Library → dual review → extraction proposals → screening sheet',blocks:[{type:'library'},{type:'dual_review'},{type:'extraction'},{type:'screening_sheet'}]},
  {id:'trials',group:'Find literature',purpose:'Re-run a ClinicalTrials.gov search and review new registrations',name:'Trial registry watch',detail:'ClinicalTrials.gov → new records → review → library',blocks:[{type:'search',source:'ctgov'},{type:'new_records'},{type:'collect',review:true},{type:'notify',text:'Trial registry watch: {{count}} new registrations'}],cron:'0 9 * * 1'},
  {id:'watch',group:'Find literature',purpose:'Re-run a search and review only what is new',name:'Literature watch',detail:'Search → new records → review → library',blocks:[{type:'search'},{type:'new_records'},{type:'collect',review:true},{type:'notify',text:'Literature watch: {{count}} records reviewed'}]},
  {id:'multi',group:'Find literature',purpose:'Search two databases and remove duplicates',name:'Multi-source search',detail:'PubMed + Europe PMC → duplicates → review → library',blocks:[{type:'search',source:'pubmed'},{type:'search',source:'epmc'},{type:'dedupe'},{type:'new_records'},{type:'collect',review:true}]},
  {id:'zotero',desktop:true,group:'Find literature',purpose:'Bring a Zotero collection in without duplicates',name:'Zotero import',detail:'Zotero → remove duplicates → review → library',blocks:[{type:'zotero'},{type:'dedupe'},{type:'collect',review:true}]},
  {id:'export',group:'Library',purpose:'Save the library as CSV, RIS or BibTeX',name:'Reference export',detail:'Library → sort → CSV, RIS or BibTeX',blocks:[{type:'library'},{type:'sort'},{type:'export'}]},
  {id:'metadata',group:'Library',purpose:'Fill missing metadata and abstracts from Crossref',name:'Metadata & abstracts',detail:'Library → Crossref → abstracts → reference export',blocks:[{type:'library'},{type:'limit',limit:50},{type:'enrich'},{type:'abstracts'},{type:'export'}]},
];
export function createFlowTemplate(id) {
  const template=FLOW_TEMPLATES.find(t=>t.id===id);if(!template)throw new Error('Unknown workflow template.');
  const blocks=template.blocks.map((b,i)=>({...BLOCK_DEFAULTS,executor:'automatic',review:false,...b,id:crypto.randomUUID(),x:40+i*280,y:60}));
  const links=template.links || (id==='multi'?[[0,2],[1,2],[2,3],[3,4]]:blocks.slice(1).map((_,i)=>[i,i+1]));
  const flow={id:crypto.randomUUID(),name:template.name,blocks,edges:links.map(([a,b,port])=>({from:blocks[a].id,to:blocks[b].id,...(port?{port}:{})})),cron:'',enabled:false,concurrency:3};
  flow.blocks=arrangeGraph(flow);return flow;
}
