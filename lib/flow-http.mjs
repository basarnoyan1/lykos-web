const MAX_BYTES=2_000_000;
export function jsonField(value,path='') {
  if(!path)return value;
  const keys=String(path).split('.');
  if(keys.some(k=>!k||['__proto__','prototype','constructor'].includes(k)))throw new Error('Use a plain JSON field path.');
  return keys.reduce((v,k)=>v!=null&&Object.hasOwn(v,k)?v[k]:undefined,value);
}
export function jsonEndpoint(value) {
  let url;try{url=new URL(value);}catch{throw new Error('Enter a complete JSON endpoint URL.');}
  if(url.username||url.password)throw new Error('Credentials in endpoint URLs are not supported.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS, or HTTP on localhost.');
  return url;
}
export async function fetchWorkflowRecords(block,{stopped=()=>false,progress=()=>{},fetcher=fetch}={}) {
  const base=jsonEndpoint(block.url),pages=Number(block.pages||1),records=[];
  for(let page=1;page<=pages;page++) {
    if(stopped())throw new Error('Workflow stopped.');
    const url=new URL(base);if(pages>1)url.searchParams.set(block.pageParam||'page',String(page));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),stopTimer=setInterval(()=>{if(stopped())controller.abort();},100);
    try {
      progress(`Page ${page} of ${pages}`);
      const response=await fetcher(url.href,{method:'GET',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(`JSON endpoint returned ${response.status}.`);
      if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('JSON response exceeds 2 MB.');
      let text='';if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error('JSON response exceeds 2 MB.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}}else{text=await response.text();if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('JSON response exceeds 2 MB.');}
      const data=JSON.parse(text),items=jsonField(data,block.itemsPath||'');
      const rows=Array.isArray(items)?items:items&&typeof items==='object'?[items]:null;
      if(!rows)throw new Error('The records path did not return an object or array.');
      if(!rows.length)break;
      if(rows.length>100)throw new Error('Return at most 100 records per page.');
      for(let i=0;i<rows.length;i++) {
        const row=rows[i],title=jsonField(row,block.titlePath||'title');if(typeof title!=='string'||!title.trim())throw new Error('The title field did not return text. Check the JSON mapping.');
        const rawId=jsonField(row,block.idPath||'id'),key=`json:${base.origin}${base.pathname}:${rawId??`${page}:${i}`}`;
        records.push({id:key,key,title,abstract:String(jsonField(row,block.abstractPath||'abstract')||''),year:String(jsonField(row,block.yearPath||'year')||''),source:'JSON endpoint'});
      }
    } catch(error){if(stopped())throw new Error('Workflow stopped.');if(error.name==='AbortError')throw new Error('JSON request timed out.');throw error;}finally{clearTimeout(timer);clearInterval(stopTimer);}
  }
  return records;
}
