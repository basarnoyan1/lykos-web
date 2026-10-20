// The fallback for a UI feature without a typed chat operation. This invokes
// the app's own controls after review, never arbitrary code or selectors.
import {get} from '../store.mjs';
import * as aid from './aid.mjs';
const ROOTS='#view,#nav,#foot,main > .topbar,#docpane';
const CONTROLS='button,input,textarea,select,[role="button"],[role="tab"]';
const SECRET=/password|credential|api[- _]?key|subscription[- _]?token|sign[- _]?in|sign[- _]?out|oauth|access[- _]?token|refresh[- _]?token/i;
const GATE=/accept\s+(?:all|proposal|change)|verify (?:row|value|evidence)|mark verified|mark checked|^checked$|allow (?:access|folder)|grant|permission/i;
const clip=(v,n=160)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
function nameOf(el) {
  return clip(el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.getAttribute('title')||el.getAttribute('placeholder')||el.textContent||el.getAttribute('name')||el.id);
}
function typeOf(el){return (el.getAttribute('type')||el.tagName||'').toLowerCase();}
function available(el){
  if(!el.isConnected||el.disabled||el.getAttribute('aria-disabled')==='true'||el.closest('[hidden],[inert],.menu,.dialog,[role="dialog"]'))return false;
  if(el.getClientRects().length===0)return false;
  if(SECRET.test(`${el.id} ${nameOf(el)} ${el.getAttribute('autocomplete')||''}`)||['password','file','hidden'].includes(typeOf(el)))return false;
  if(GATE.test(nameOf(el)))return false;
  return ['button','input','textarea','select'].includes(el.tagName?.toLowerCase())||['button','tab'].includes(el.getAttribute('role'));
}
function fingerprint(el){return JSON.stringify({tag:el.tagName,type:typeOf(el),name:nameOf(el),value:el.value??null,checked:el.checked??null,options:el.options?[...el.options].map(o=>[o.value,o.textContent,o.disabled]):null});}
export function createAppInteractions({document:doc=globalThis.document,getState=get,fileProposal=aid.file,model='Assistant',prompt=''}={}) {
  const handles=new Map(),elementHandles=new WeakMap();let sequence=0;
  const inspect=({offset=0,limit=25}={})=>{
    if(!doc)return {available:false,reason:'App controls are available in the interactive app only.'};
    const elements=[...new Set([...doc.querySelectorAll(ROOTS)].flatMap(r=>r.matches(CONTROLS)?[r]:[...r.querySelectorAll(CONTROLS)]))].filter(available);
    offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.max(1,Math.min(40,Math.floor(Number(limit)||25)));
    const project=getState().project;
    for(const [id,h]of handles)if(!h.el.isConnected||h.project!==project)handles.delete(id);
    const controls=elements.slice(offset,offset+limit).map(el=>{
      const snapshot=fingerprint(el),previous=elementHandles.get(el),handle=handles.get(previous);
      let id=handle?.fingerprint===snapshot?previous:null;
      if(!id){
        if(previous)handles.delete(previous);
        id=`control-${++sequence}`;handles.set(id,{el,fingerprint:snapshot,project});elementHandles.set(el,id);
      }
      const type=typeOf(el),editable=['input','textarea','select'].includes(el.tagName.toLowerCase());
      return {id,label:nameOf(el),kind:type,...(editable?{value:clip(el.value,300)}:{}),...(type==='checkbox'?{checked:el.checked}:{}),...(el.options?{options:[...el.options].slice(0,50).map(o=>({value:o.value,label:clip(o.textContent),disabled:o.disabled}))}:{})};
    });
    // Keep references bounded; proposals retain only their own control handle.
    while(handles.size>160)handles.delete(handles.keys().next().value);
    return {controls,total:elements.length,offset,next_offset:offset+limit<elements.length?offset+limit:null,note:'Visible app controls only. Use typed tools when available; otherwise propose an interaction by id. Credential, verification and approval controls are excluded.'};
  };
  const propose=({control,action,value,reason}={})=>{
    const h=handles.get(control);if(!h)throw new Error('Control not found; inspect_app again.');
    const el=h.el,type=typeOf(el),tag=el.tagName.toLowerCase(),label=nameOf(el);
    if(getState().project!==h.project||!available(el)||fingerprint(el)!==h.fingerprint)throw new Error('The app control changed; inspect_app again.');
    if(!['click','set','select','check'].includes(action))throw new Error('Use click, set, select or check.');
    if(action==='click'&&(!['button'].includes(tag)&&!['button','tab'].includes(el.getAttribute('role'))))throw new Error('Only buttons or tabs can be clicked.');
    if(action==='set'&&(!['input','textarea'].includes(tag)||!['text','search','number','date','email','url','tel','textarea'].includes(type)||el.readOnly))throw new Error('This control is not an editable text field.');
    if(action==='set'&&(typeof value!=='string'||value.length>20000))throw new Error('Use text under 20000 characters.');
    if(action==='select'&&(tag!=='select'||![...el.options].some(o=>o.value===value&&!o.disabled)))throw new Error('Choose an available option from inspect_app.');
    if(action==='check'&&(type!=='checkbox'||typeof value!=='boolean'))throw new Error('Checkbox values must be true or false.');
    const entry=fileProposal({view:'app',title:'App interaction',meta:model,prompt,items:[{label:`${action==='click'?'Open or run':action==='check'?'Set':'Change'}: ${label}`,detail:[clip(reason,400),action!=='click'?`Value: ${clip(value,800)}`:''].filter(Boolean).join('\n'),acceptLabel:'Apply',accept:()=>{
      if(getState().project!==h.project||!available(el)||fingerprint(el)!==h.fingerprint)return {refused:'The screen or control changed. Ask chat to inspect it again.'};
      if(action==='click')el.click();
      else if(action==='check'){if(el.checked!==value)el.click();}
      else {el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
      return `Applied to ${label}`;
    }}]});
    return {entry_id:entry.id,status:'awaiting_review',control:label,note:'One app interaction proposed. The reviewer applies it in Proposals; dependent interactions require inspecting the resulting screen again.'};
  };
  return {inspect,propose};
}
