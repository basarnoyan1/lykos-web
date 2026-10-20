// One derived index for the open store version. Values remain authoritative;
// plain snapshots are rebuilt because their callers may mutate them in place.
import { get, getIndexVersion, subscribe } from '../store.mjs';
import { libraryIndex } from './search-library.mjs';
let cached=null,identities=null;
// Release references immediately after edits/switches, even if no lookup follows.
subscribe(()=>{
  const state=get(),version=getIndexVersion();
  if(cached&&(cached.state!==state||cached.version!==version))cached=null;
  if(identities&&(identities.state!==state||identities.version!==version))identities=null;
});
export function projectLibraryIndex(state) {
  const version=state===get()?getIndexVersion():-1;
  if(version>=0&&identities?.state===state&&identities.version===version)return identities.index;
  const index=libraryIndex(state.papers||[]);
  if(version>=0)identities={state,version,index};
  return index;
}
export function projectIndex(state) {
  const version=state===get()?getIndexVersion():-1;
  if(version>=0&&cached?.state===state&&cached.version===version)return cached.index;
  const papers=new Map((state.papers||[]).map(p=>[p.id,p]));
  const values=new Map(),proposals=new Map(),notes=new Map();
  const add=(map,id,value)=>{if(!map.has(id))map.set(id,[]);map.get(id).push(value);};
  const indexCells=(object,map)=>{for(const key in object||{}) {
    let cut=key.lastIndexOf(':');if(cut<0)continue;
    // Prefer the longest known ID, including when one ID prefixes another.
    while(cut>=0&&!papers.has(key.slice(0,cut)))cut=cut===0?-1:key.lastIndexOf(':',cut-1);
    if(cut>=0)add(map,key.slice(0,cut),[key,object[key]]);
  }};
  indexCells(state.values,values);indexCells(state.proposals,proposals);
  for(const note of state.notes||[])add(notes,note.paper,note);
  const index={papers,values,proposals,notes};
  if(version>=0)cached={state,version,index};
  return index;
}
