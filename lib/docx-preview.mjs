// A local, read-only Word preview. Render document structure without executing
// document markup or fetching external relationships. Saving remains in docx-edit.
import { codePoint } from './xml.mjs';
import { readText, read, entries } from './unzip.mjs';
import { paragraphIndexes } from './docx-edit.mjs';
import { esc } from './html.mjs';

const decode = s => String(s).replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (_, n, h, d) => n ? ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n.toLowerCase()] : codePoint(parseInt(h || d, h ? 16 : 10)));
function tree(xml = '') {
  const root = {name:'root', children:[]}, stack = [root];
  const tags = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(![^>]*|\/?[\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  for (const m of xml.matchAll(tags)) {
    if (m.index > last) stack.at(-1).children.push({name:'#text', text:decode(xml.slice(last,m.index))});
    last = m.index + m[0].length;
    if (!m[1] || m[1][0] === '!') continue;
    if (m[1][0] === '/') { if(stack.length > 1) stack.pop(); continue; }
    const node = {name:m[1], start:m.index, attrs:{}, children:[]};
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[2] ?? a[3]);
    stack.at(-1).children.push(node);
    if (!/\/\s*>$/.test(m[0])) stack.push(node);
  }
  return root;
}
const child = (n, name) => n?.children?.find(x => x.name === name);
const children = (n, name) => n?.children?.filter(x => x.name === name) || [];
const descendants = (n, name) => (n?.children || []).flatMap(x => x.name === name ? [x] : descendants(x,name));
const val = (n, name) => child(n,name)?.attrs['w:val'];
const num = (v, fallback = 0) => Number.isFinite(Number(v)) && v !== undefined ? Number(v) : fallback;
const bounded = (v, low, high, fallback) => Math.max(low, Math.min(high, num(v,fallback)));
const on = n => n && !['0','false','off','none'].includes(n.attrs['w:val']);
const hex = v => /^[0-9a-f]{6}$/i.test(v || '') ? `#${v}` : null;
const safeFont = v => v?.replace(/[^\p{L}\p{N} ,_-]/gu,'').slice(0,100);
function runStyle(pr) {
  const s = {};
  for (const [tag,prop,yes,no] of [['w:b','font-weight','700','400'],['w:i','font-style','italic','normal']]) {
    const t = child(pr,tag); if(t) s[prop] = on(t) ? yes : no;
  }
  const sz = val(pr,'w:sz'); if(sz) s['font-size'] = `${bounded(sz,12,192,22)/2}pt`;
  const font = child(pr,'w:rFonts')?.attrs; const family = safeFont(font?.['w:ascii'] || font?.['w:hAnsi']);
  if(family) s['font-family'] = `'${family}'`;
  const color = hex(val(pr,'w:color')); if(color) s.color = color;
  const decorations = []; if(on(child(pr,'w:u'))) decorations.push('underline'); if(on(child(pr,'w:strike'))) decorations.push('line-through');
  if(decorations.length) s['text-decoration'] = decorations.join(' ');
  const vert = val(pr,'w:vertAlign'); if(['superscript','subscript'].includes(vert)) {s['vertical-align'] = vert === 'superscript' ? 'super':'sub';s['font-size']='0.75em';}
  return s;
}
function paragraphStyle(pr) {
  const s = {}, alignment = val(pr,'w:jc');
  if(['left','right','center','both','start','end'].includes(alignment)) s['text-align'] = alignment === 'both' ? 'justify' : alignment;
  const spacing = child(pr,'w:spacing')?.attrs;
  for(const [attr,prop] of [['w:before','margin-top'],['w:after','margin-bottom']]) if(spacing?.[attr] !== undefined) s[prop]=`${bounded(spacing[attr],0,2880,0)/20}pt`;
  if(spacing?.['w:line']) s['line-height'] = spacing['w:lineRule'] === 'exact' ? `${bounded(spacing['w:line'],120,1440,240)/20}pt` : bounded(num(spacing['w:line'])/240,1,3,1.3);
  const ind = child(pr,'w:ind')?.attrs;
  for(const [attr,prop] of [['w:left','margin-left'],['w:right','margin-right'],['w:firstLine','text-indent']]) if(ind?.[attr]) s[prop]=`${bounded(ind[attr],0,4320,0)/20}pt`;
  if(ind?.['w:hanging']) s['text-indent'] = `${-bounded(ind['w:hanging'],0,1440,0)/20}pt`;
  return s;
}
const style = s => Object.keys(s).length ? ` style="${esc(Object.entries(s).map(([k,v])=>`${k}:${v}`).join(';'))}"` : '';

export async function previewDocx(bytes, imageUrl = () => '') {
  const xml = await readText(bytes,'word/document.xml'); if(!xml) throw new Error('Not a Word document');
  const [stylesXml, relsXml, numberingXml] = await Promise.all(['word/styles.xml','word/_rels/document.xml.rels','word/numbering.xml'].map(p=>readText(bytes,p)));
  const document = tree(xml), body = descendants(document,'w:body')[0], indexes = paragraphIndexes(xml);
  const styles = new Map(descendants(tree(stylesXml || ''),'w:style').map(n=>[n.attrs['w:styleId'],n]));
  const defaults = descendants(tree(stylesXml || ''),'w:docDefaults')[0];
  function inherited(id, depth = 0) {
    const n = styles.get(id); if(!n || depth > 12) return {run:{},para:{}};
    const base = inherited(val(n,'w:basedOn'),depth+1);
    return {run:{...base.run,...runStyle(child(n,'w:rPr'))},para:{...base.para,...paragraphStyle(child(n,'w:pPr'))}};
  }
  const normal = inherited('Normal');
  const defaultRun = {...runStyle(child(child(defaults,'w:rPrDefault'),'w:rPr')),...normal.run};
  const defaultPara = {...paragraphStyle(child(child(defaults,'w:pPrDefault'),'w:pPr')),...normal.para};
  const rels = new Map(descendants(tree(relsXml || ''),'Relationship').map(n=>[n.attrs.Id,n.attrs]));
  const images = new Map();
  for(const n of descendants(document,'a:blip').concat(descendants(document,'v:imagedata'))) {
    const id = n.attrs['r:embed'] || n.attrs['r:id'], r = rels.get(id);
    if(!r || r.TargetMode === 'External' || images.has(id)) continue;
    const path = r.Target?.startsWith('/') ? r.Target.slice(1) : `word/${r.Target}`;
    if(!path || path.includes('..') || !/^word\/media\//.test(path)) continue;
    const type = ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'})[path.split('.').pop().toLowerCase()];
    const entry = type && entries(bytes).find(e=>e.name===path); if(entry) images.set(id,imageUrl(await read(bytes,entry),type));
  }
  const numbering = tree(numberingXml || ''), counters = new Map();
  function marker(pr) {
    const list = child(pr,'w:numPr'); if(!list || val(list,'w:numId') === '0') return '';
    const id = val(list,'w:numId'), level = num(val(list,'w:ilvl')), n = descendants(numbering,'w:num').find(x=>x.attrs['w:numId']===id);
    const abstract = descendants(numbering,'w:abstractNum').find(x=>x.attrs['w:abstractNumId']===val(n,'w:abstractNumId'));
    const def = children(abstract,'w:lvl').find(x=>num(x.attrs['w:ilvl'])===level), format = val(def,'w:numFmt');
    let text = '•';
    if(format && format !== 'bullet') {
      const key = `${id}:${level}`, count = (counters.get(key) ?? (num(val(def,'w:start'),1)-1))+1; counters.set(key,count);
      for(const k of counters.keys()) if(k.startsWith(`${id}:`) && +k.split(':')[1] > level) counters.delete(k);
      const value = /[Ll]etter/.test(format) ? String.fromCharCode((format==='upperLetter'?65:97)+(count-1)%26) : String(count);
      text = (val(def,'w:lvlText') || '%1.').replace(/%\d/g,value);
    }
    return text;
  }
  function inline(n) {
    if(['w:del','mc:Fallback','w:pPr','w:rPr','w:instrText','w:txbxContent'].includes(n.name)) return '';
    if(n.name === 'w:t') return n.children.map(c=>esc(c.text || '')).join('');
    if(n.name === 'w:tab') return '\t';
    if(n.name === 'w:br' || n.name === 'w:cr') return '<br>';
    if(n.name === 'w:drawing' || n.name === 'w:pict') {
      const b = descendants(n,'a:blip')[0] || descendants(n,'v:imagedata')[0], url = images.get(b?.attrs['r:embed'] || b?.attrs['r:id']);
      const docPr = descendants(n,'wp:docPr')[0], extent = descendants(n,'wp:extent')[0];
      return url ? `<img src="${esc(url)}" alt="${esc(docPr?.attrs.descr || docPr?.attrs.name || 'Document image')}"${style(extent ? {width:`${bounded(num(extent.attrs.cx)/9525,1,2000,500)}px`}: {})} contenteditable="false">` : '';
    }
    const content = (n.children || []).map(inline).join('');
    if(n.name === 'w:r') return `<span${style({...inherited(val(child(n,'w:rPr'),'w:rStyle')).run,...runStyle(child(n,'w:rPr'))})}>${content}</span>`;
    if(n.name === 'w:hyperlink') {
      const target = rels.get(n.attrs['r:id'])?.Target;
      if(/^https?:\/\//i.test(target || '')) return `<a href="${esc(target)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    }
    return content;
  }
  function paragraph(n) {
    if (!indexes.has(n.start)) return '';
    const pr = child(n,'w:pPr'), id = val(pr,'w:pStyle'), st = inherited(id), headingName = val(styles.get(id),'w:name') || id || '';
    const level = /heading\s*([1-6])/i.exec(headingName)?.[1], title = /^title$/i.test(headingName);
    const tag = level ? `h${level}` : title ? 'h1' : 'p', m = marker(pr);
    const css = {...defaultPara,...st.para,...paragraphStyle(pr),...st.run};
    const pageBreak = on(child(pr,'w:pageBreakBefore')) || descendants(n,'w:br').some(b=>b.attrs['w:type']==='page');
    return `<${tag} class="fv-p${m?' fv-list-item':''}${pageBreak?' fv-page-break':''}" data-i="${indexes.get(n.start) ?? ''}"${m ? ` data-list-marker="${esc(m)}"` : ''}${style(css)}>${inline(n)}</${tag}>`;
  }
  function table(n) {
    const rows = children(n,'w:tr'), grid = children(child(n,'w:tblGrid'),'w:gridCol').map(c=>num(c.attrs['w:w'])), total = grid.reduce((a,b)=>a+b,0);
    const active = new Map(), rendered = [];
    for(const row of rows) {
      let column = num(val(child(row,'w:trPr'),'w:gridBefore')), cells = [];
      for(const cell of children(row,'w:tc')) {
        const pr = child(cell,'w:tcPr'), span = bounded(val(pr,'w:gridSpan'),1,100,1), merge = child(pr,'w:vMerge');
        if(merge && merge.attrs['w:val'] !== 'restart' && active.has(column)) {active.get(column).rowspan++;column+=span;continue;}
        const info = {span,rowspan:1,cell,header:on(child(child(row,'w:trPr'),'w:tblHeader'))}; cells.push(info);
        for(let i=column;i<column+span;i++) active.delete(i);
        if(merge) active.set(column,info);
        column+=span;
      }
      rendered.push(cells);
    }
    return `<div class="fv-table-wrap"><table class="fv-word-table">${total?`<colgroup>${grid.map(w=>`<col style="width:${w/total*100}%">`).join('')}</colgroup>`:''}<tbody>${rendered.map(row=>`<tr>${row.map(c=>{
      const pr = child(c.cell,'w:tcPr'), fill = hex(child(pr,'w:shd')?.attrs['w:fill']), align = val(pr,'w:vAlign'), tag = c.header ? 'th':'td';
      return `<${tag}${c.header?' scope="col"':''} colspan="${c.span}" rowspan="${c.rowspan}"${style({...fill?{'background-color':fill}:{},...['center','bottom'].includes(align)?{'vertical-align':align==='center'?'middle':align}:{}})}>${blocks(c.cell)}</${tag}>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function blocks(n) { return (n?.children || []).map(c=>c.name==='w:p'?paragraph(c)+descendants(c,'w:txbxContent').map(blocks).join(''):c.name==='w:tbl'?table(c):['w:sdt','w:sdtContent','w:customXml','w:ins'].includes(c.name)?blocks(c):'').join(''); }
  const section = descendants(body,'w:sectPr').at(-1), pg = child(section,'w:pgSz')?.attrs, margins = child(section,'w:pgMar')?.attrs;
  const width = bounded(num(pg?.['w:w'],12240)/15,400,1600,816), height = bounded(num(pg?.['w:h'],15840)/15,400,2200,1056);
  const padding = ['top','right','bottom','left'].map(side=>`${bounded(num(margins?.[`w:${side}`],1080)/15,12,150,72)}px`).join(' ');
  return {html:blocks(body), width, height, pageStyle:style({...defaultRun,padding,width:`${width}px`,'min-height':`${height}px`})};
}
