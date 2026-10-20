export const FLOW_VALUES = [
  {key:'count',label:'Record count',description:'Unique records entering this block'},
  {key:'output',label:'Previous output',description:'Text from connected inputs, in connection order'},
];
const pattern = /\{\{\s*([^{}]*?)\s*\}\}/g;
export function flowTextValues(text) {
  return [...String(text||'').matchAll(pattern)].map(m=>({key:m[1].trim(),start:m.index,end:m.index+m[0].length}));
}
export function resolveFlowText(text, {count=0,output=''}={}) {
  // A callback preserves dollar signs and placeholder-like text in upstream output.
  return String(text||'').replace(pattern,(token,key)=>key.trim()==='count'?String(count):key.trim()==='output'?String(output):token);
}
export function insertFlowValue(text, key, start, end=start) {
  if(!FLOW_VALUES.some(v=>v.key===key))throw new Error('Unknown workflow value.');
  const token=`{{${key}}}`,value=String(text||'');
  return {text:value.slice(0,start)+token+value.slice(end),caret:start+token.length};
}
