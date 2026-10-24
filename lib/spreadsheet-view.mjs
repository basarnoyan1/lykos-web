import { position, colName, parseDelimited, writeDelimited } from './spreadsheet.mjs';
const escapeHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const GRID_LIMIT = 50000;
export const mergeRegions = sheet => (sheet.merges || []).map(ref=>{const [a,b]=ref.split(':');return {ref,anchor:a,start:position(a),end:position(b)};});
export function mergedCell(sheet, ref) {
  const p=position(ref);return mergeRegions(sheet).find(m=>p.row>=m.start.row&&p.row<=m.end.row&&p.col>=m.start.col&&p.col<=m.end.col);
}
export function sheetDimensions(sheet) {
  const merges=mergeRegions(sheet);
  // A loop, not Math.max(...rows): a sheet of 200,000 rows exceeds the argument limit.
  let rows=Math.max(20,sheet.rows.length),cols=8;
  for(const r of sheet.rows)if((r?.length||0)>cols)cols=r.length;
  for(const m of merges){if(m.end.row+1>rows)rows=m.end.row+1;if(m.end.col+1>cols)cols=m.end.col+1;}
  return {rows,cols};
}
// Counts exclude the blank padding supplied for editing below the used range.
export function usedRowCount(sheet, model) {
  return Math.max(sheet.rows.length, ...mergeRegions(sheet).map(m=>m.end.row+1),
    ...Object.keys(sheet.formulas || {}).map(ref=>position(ref).row+1),
    ...model.edits().filter(e=>e.sheet===sheet.name).map(e=>position(e.cell).row+1));
}
function rowGroups(sheet, count) {
  const merges=mergeRegions(sheet), groups=[];
  for(let r=0;r<count;) {
    let end=r;
    do {const prev=end;for(const m of merges)if(m.start.row<=end&&m.end.row>=r)end=Math.max(end,m.end.row);if(prev===end)break;} while(end<count);
    groups.push(Array.from({length:end-r+1},(_,i)=>r+i));r=end+1;
  }
  return groups;
}
function displayedValue(sheet, model, row, column, merges) {
  const merge=merges.find(m=>row>=m.start.row&&row<=m.end.row&&column>=m.start.col&&column<=m.end.col);
  return model.value(sheet.name,merge?.anchor || `${colName(column)}${row+1}`);
}
export function filterValues(sheet, model, column) {
  const counts=new Map(), groups=rowGroups(sheet,usedRowCount(sheet,model)), merges=mergeRegions(sheet);
  for(const row of groups.slice(1).flat()) {
    const value=displayedValue(sheet,model,row,Number(column),merges);
    counts.set(value,(counts.get(value)||0)+1);
  }
  const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  return [...counts].map(([value,count])=>({value,count})).sort((a,b)=>a.value===''?1:b.value===''?-1:collator.compare(a.value,b.value));
}
export function filteredRowCount(sheet,model,rows) {
  const used=usedRowCount(sheet,model), header=rowGroups(sheet,used)[0]?.length || 0;
  return {shown:rows.filter(r=>r>=header&&r<used).length,total:Math.max(0,used-header)};
}
// Sort/filter row groups in the view; physical coordinates and saved formulas stay intact.
export function visibleRows(sheet, model, {sort=null,filter=null}={}) {
  const dims=sheetDimensions(sheet), merges=mergeRegions(sheet);
  const query=String(filter?.text||'').toLocaleLowerCase(), values=filter?.values == null?null:new Set(filter.values);
  const filtering=Boolean(query)||values!==null;
  const groups=rowGroups(sheet,filtering?usedRowCount(sheet,model):Math.max(dims.rows,usedRowCount(sheet,model)));
  const header=groups.shift() || [];
  let data=groups.filter(group=>!filtering || group.some(r=>{
    const cs=filter.column==='all'?Array.from({length:dims.cols},(_,c)=>c):[Number(filter.column)];
    return cs.some(c=>{const value=displayedValue(sheet,model,r,c,merges);return (!query||value.toLocaleLowerCase().includes(query))&&(!values||values.has(value));});
  }));
  if(sort) {
    const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
    const v=g=>g.map(r=>model.value(sheet.name,`${colName(sort.column)}${r+1}`)).find(x=>x.trim())||'';
    data.sort((a,b)=>{const av=v(a),bv=v(b);if(!av&&!bv)return a[0]-b[0];if(!av)return 1;if(!bv)return -1;const numeric=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;const comparison=numeric.test(av.trim())&&numeric.test(bv.trim())?Number(av)-Number(bv):collator.compare(av,bv);return comparison*(sort.direction==='desc'?-1:1)||a[0]-b[0];});
  }
  return [...header,...data.flat()];
}
// `cols` is the visible columns in order (hidden ones left out); without it every column between the corners is in the range.
export function visualRange(from,to,rows,limit=GRID_LIMIT,cols=null) {
  const a=position(from),b=position(to),ai=rows.indexOf(a.row),bi=rows.indexOf(b.row),out=[];
  if(ai<0||bi<0)throw new Error('Select visible cells first.');
  const lo=Math.min(a.col,b.col),hi=Math.max(a.col,b.col),across=cols?cols.filter(c=>c>=lo&&c<=hi):Array.from({length:hi-lo+1},(_,i)=>lo+i);
  if((Math.abs(ai-bi)+1)*across.length>limit)throw new Error(`Select up to ${limit} cells.`);
  for(let i=Math.min(ai,bi);i<=Math.max(ai,bi);i++)for(const c of across)out.push(`${colName(c)}${rows[i]+1}`);
  return out;
}
// The rows and columns a selection touches, in display order: a selection over hidden columns or filtered rows is still one rectangle of what is shown.
function grid(selected,rows) {
  const ps=[...selected].map(position),ri=new Set(ps.map(p=>rows.indexOf(p.row))),cs=[...new Set(ps.map(p=>p.col))].sort((a,b)=>a-b);
  const ris=[...ri].sort((a,b)=>a-b);
  if(!ps.length||ris[0]<0)throw new Error('Select visible cells first.');
  return {rows:ris.map(i=>rows[i]),cols:cs,rectangular:ris.length*cs.length===selected.size};
}
/** The selected cells as a matrix of text (rows of what the grid shows), or an error when the selection is not one rectangle. */
export function selectionMatrix(sheet,model,selected,rows) {
  const g=grid(selected,rows);
  if(!g.rectangular)throw new Error('Copy one rectangular range at a time.');
  return g.rows.map(r=>g.cols.map(c=>model.value(sheet.name,`${colName(c)}${r+1}`)));
}
export function copyCells(sheet,model,selected,rows) {
  return writeDelimited(selectionMatrix(sheet,model,selected,rows),{delimiter:'\t'});
}
/** The sheet's shown rows and columns as a matrix (what Download sheet writes: filtered and sorted rows in order, hidden columns left out). */
export function sheetMatrix(sheet,model,rows,cols) {
  const last=usedRowCount(sheet,model),shown=rows.filter(r=>r<last);
  return shown.map(r=>cols.map(c=>model.value(sheet.name,`${colName(c)}${r+1}`)));
}
/** A matrix as comma-separated text, quoted where a value holds a comma, a quote or a line break. */
export const matrixCsv = matrix => writeDelimited(matrix,{delimiter:',',newline:'\r\n',trailing:true});
/** A matrix as an HTML table, for pasting into a document or a mail as a table. */
export const matrixHtml = matrix => `<table>${matrix.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(v).replace(/\r?\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</table>`;
export function pasteCells(sheet,model,selected,active,text,rows,cols=null) {
  const matrix=parseDelimited(text,'\t').rows;if(!matrix.length)matrix.push(['']);
  const points=[...selected].map(position);
  const dims=sheetDimensions(sheet),across=cols||Array.from({length:dims.cols},(_,i)=>i);
  const start=selected.size>1?{row:rows[Math.min(...points.map(p=>rows.indexOf(p.row)))],col:Math.min(...points.map(p=>p.col))}:position(active),ri=rows.indexOf(start.row),ci=across.indexOf(start.col);
  const edits=[];
  if(matrix.length===1&&matrix[0].length===1&&selected.size>1) {
    const seen=new Set();for(const cell of selected){const ref=mergedCell(sheet,cell)?.anchor||cell;if(!seen.has(ref)){edits.push({sheet:sheet.name,cell:ref,value:matrix[0][0]});seen.add(ref);}}
  } else {
    if(ri<0||ci<0||ri+matrix.length>rows.length||ci+Math.max(...matrix.map(r=>r.length))>across.length)throw new Error('The pasted range extends outside this worksheet.');
    for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix[r].length;c++){
      const ref=`${colName(across[ci+c])}${rows[ri+r]+1}`,merge=mergedCell(sheet,ref);
      if(merge && (matrix.length>1||matrix[r].length>1))throw new Error('Paste into merged cells one value at a time.');
      edits.push({sheet:sheet.name,cell:merge?.anchor||ref,value:matrix[r][c]});
    }
  }
  if(edits.length>GRID_LIMIT)throw new Error(`Paste up to ${GRID_LIMIT} cells at a time.`);
  for(const e of edits)if(model.formula(e.sheet,e.cell))throw new Error(`${e.cell} contains a formula. No cells were pasted.`);
  return edits;
}
/**
 * Fill down or right: the first row (or column) of the selection is copied over the rest, as in a spreadsheet; one cell takes the value of the cell
 * above it (or to its left). Values only. A formula is never written over, and a formula is not copied: either throws, and nothing is applied.
 */
export function fillEdits(sheet,model,selected,rows,direction,cols=null) {
  const g=grid(selected,rows),down=direction==='down',edits=[],seen=new Set();
  if(!g.rectangular)throw new Error('Fill one rectangular range at a time.');
  const read=ref=>{if(model.formula(sheet.name,ref))throw new Error(`${ref} contains a formula. Fill copies values only.`);return model.value(sheet.name,ref);};
  const across=cols||Array.from({length:sheetDimensions(sheet).cols},(_,i)=>i);
  const single=selected.size===1;
  const lines=down?g.cols:g.rows,steps=down?g.rows:g.cols;
  for(const line of lines){
    let source;
    if(single){
      const at=down?rows.indexOf(g.rows[0])-1:across.indexOf(g.cols[0])-1;
      if(at<0)throw new Error(down?'There is no cell above to fill from.':'There is no cell to the left to fill from.');
      source=read(down?`${colName(line)}${rows[at]+1}`:`${colName(across[at])}${line+1}`);
    } else source=read(down?`${colName(line)}${steps[0]+1}`:`${colName(steps[0])}${line+1}`);
    for(const step of single?[steps[0]]:steps.slice(1)){
      const raw=down?`${colName(line)}${step+1}`:`${colName(step)}${line+1}`,ref=mergedCell(sheet,raw)?.anchor||raw;
      if(seen.has(ref))continue;seen.add(ref);
      if(model.formula(sheet.name,ref))throw new Error(`${ref} contains a formula. No cells were filled.`);
      edits.push({sheet:sheet.name,cell:ref,value:source});
    }
  }
  return edits;
}
// ---- find and replace ----------------------------------------------------------------------------------------------------------------
const same=(a,b,matchCase)=>matchCase?a:a.toLocaleLowerCase();
/**
 * The cells whose text holds `query`, in reading order of what is shown (the sheet's rows as sorted and filtered, its visible columns left to right).
 * A merged range is one cell, at its anchor. Formula cells are found (their cached value is what is shown) and are never replaced.
 */
export function findCells(sheet,model,query,{matchCase=false,rows=[],cols=[]}={}) {
  const q=String(query||'');if(!q)return [];
  const needle=same(q,q,matchCase),out=[],merges=mergeRegions(sheet),last=usedRowCount(sheet,model);
  for(const r of rows){
    if(r>=last)continue;
    for(const c of cols){
      const ref=`${colName(c)}${r+1}`,m=merges.find(x=>r>=x.start.row&&r<=x.end.row&&c>=x.start.col&&c<=x.end.col);
      if(m&&m.anchor!==ref)continue;
      if(same(model.value(sheet.name,ref),q,matchCase).includes(needle))out.push(ref);
    }
  }
  return out;
}
/** `value` with the first (or every) occurrence of `query` replaced, or the same text when there is none. A literal match: no pattern characters. */
export function replaceText(value,query,replacement,{matchCase=false,all=true}={}) {
  const q=String(query||'');if(!q)return String(value);
  const text=String(value),hay=matchCase?text:text.toLocaleLowerCase(),needle=matchCase?q:q.toLocaleLowerCase();
  let out='',at=0;
  for(;;){
    const i=hay.indexOf(needle,at);
    if(i<0)break;
    out+=text.slice(at,i)+replacement;at=i+q.length;
    if(!all)break;
  }
  return out+text.slice(at);
}
/** The edits that replace in `refs`, and how many of those cells were skipped because they hold a formula (the file keeps its formulas as they are). */
export function replaceEdits(sheet,model,refs,query,replacement,{matchCase=false,all=true}={}) {
  const edits=[];let skipped=0;
  for(const ref of refs){
    if(model.formula(sheet.name,ref)){skipped++;continue;}
    const before=model.value(sheet.name,ref),after=replaceText(before,query,replacement,{matchCase,all});
    if(after!==before)edits.push({sheet:sheet.name,cell:ref,value:after});
  }
  return {edits,skipped};
}
/** The number of rows at the top that make the first row group (a merged first row counts all the rows it spans): the rows "Freeze first row" holds. */
export const headerRows = sheet => rowGroups(sheet,1)[0]?.length || 1;
// Neutral source colors follow the theme; chromatic fills retain their hue.
export function cellStyle(style={}) {
  const chromatic=c=>/^#[a-f\d]{6}$/i.test(c||'')&&Math.max(...c.slice(1).match(/../g).map(v=>parseInt(v,16)))-Math.min(...c.slice(1).match(/../g).map(v=>parseInt(v,16)))>20;
  return [chromatic(style.fill)?`--ss-fill:${style.fill}`:'',chromatic(style.color)?`--ss-ink:${style.color}`:'',style.bold?'font-weight:600':'',style.italic?'font-style:italic':'', ['left','center','right'].includes(style.align)?`text-align:${style.align}`:''].filter(Boolean).join(';');
}
