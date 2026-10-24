// Local matching: exact IDs and phrases first, words in any order, then short
// command abbreviations. Only the best K rows are retained, with stable ties.
const LETTERS={'ı':'i','ß':'ss','ø':'o','đ':'d','ł':'l','æ':'ae','œ':'oe'};
export const foldSearch=text=>String(text??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[ıßøđłæœ]/g,c=>LETTERS[c]);
export function score(q,text) {return scoreFolded(foldSearch(q).trim(),foldSearch(text));}
function scoreFolded(query,t) {
  if(!query)return 1;
  if(t===query)return 100;
  if(t.startsWith(query))return 80+10/(t.length+1);
  if(t.includes(query))return 60+10/(t.length+1);
  const terms=query.split(/\s+/);
  if(terms.length>1)return terms.every(term=>t.includes(term))?40+10/(t.length+1):0;
  if(query.length>32)return 0;
  let ti=0,s=0,run=0;
  for(const c of query){const at=t.indexOf(c,ti);if(at<0)return 0;const start=at===0||/[\s/_.\-·(]/.test(t[at-1]);run=at===ti?run+1:0;s+=1+(start?3:0)+run*2-Math.min(at-ti,6)*.2;ti=at+1;}
  return Math.min(30,s+10/(t.length+1));
}
const folded=new WeakMap();
function prepared(it){const label=String(it.label||''),keys=String(it.keys||'');let c=folded.get(it);if(!c||c.label!==label||c.keys!==keys){c={label,keys,foldLabel:foldSearch(label),foldKeys:foldSearch(keys),joined:foldSearch(`${label} ${keys}`)};folded.set(it,c);}return c;}
const better=(a,b)=>a.s>b.s||(a.s===b.s&&(a.rank<b.rank||(a.rank===b.rank&&a.order<b.order)));
/** `alts` [{ q, w }] and `extra(item)`: lib/search-smart.mjs */
const sc=(q,c)=>Math.max(scoreFolded(q,c.foldLabel),c.keys?scoreFolded(q,c.foldKeys)*.8:0,q.includes(' ')?scoreFolded(q,c.joined)*.7:0);
export function rankItems(items,query,{limit=60,alts=null,extra=null}={}) {
  const q=foldSearch(query).trim(),cap=Math.max(1,Math.min(100,limit)),heap=[];
  const down=()=>{let i=0;for(;;){let worst=i,l=i*2+1,r=l+1;if(l<heap.length&&better(heap[worst],heap[l]))worst=l;if(r<heap.length&&better(heap[worst],heap[r]))worst=r;if(worst===i)break;[heap[i],heap[worst]]=[heap[worst],heap[i]];i=worst;}};
  items.forEach((it,order)=>{if(it.fallback||(!q&&(it.rank??5)>2))return;const c=prepared(it);
    let s=sc(q,c);
    if(s<40&&alts&&q)for(const a of alts)s=Math.max(s,a.w*sc(a.q,c));
    if(s<=0&&extra&&q)s=extra(c);
    if(s<=0)return;
    const row={it,s,rank:it.rank??5,order};
    if(heap.length<cap){heap.push(row);let i=heap.length-1;while(i){const p=(i-1)>>1;if(!better(heap[p],heap[i]))break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}}
    else if(better(row,heap[0])){heap[0]=row;down();}
  });
  return heap.sort((a,b)=>better(a,b)?-1:better(b,a)?1:0).map(x=>x.it);
}
