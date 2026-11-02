// Source cell formatting and merge geometry; the viewer adapts color to its theme.
const attr = (s, k) => new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s || '')?.[1];
const block = (s, tag) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`).exec(s || '')?.[1] || '';
const tags = (s, tag) => [...(s || '').matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>)`, 'g'))];
const INDEXED = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
export function workbookStyles(xml = '', themeXml = '') {
  const scheme = block(themeXml,'clrScheme');
  const theme = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map(k=>{
    const x=block(scheme,k), c=tags(x,'srgbClr')[0] || tags(x,'sysClr')[0]; return attr(c?.[1],'val')?.match(/^[a-f\d]{6}$/i)?.[0] || attr(c?.[1],'lastClr');
  });
  const indexed = tags(block(xml,'indexedColors'),'rgbColor').map(m=>attr(m[1],'rgb')?.slice(-6));
  const color = a => {
    let hex=attr(a,'rgb')?.slice(-6) || theme[+attr(a,'theme')] || (indexed.length ? indexed : INDEXED)[+attr(a,'indexed')];
    if(!/^[a-f\d]{6}$/i.test(hex || '')) return null;
    const tint=Number(attr(a,'tint') || 0);
    hex=hex.match(/../g).map(v=>{const n=parseInt(v,16);return Math.round(Math.max(0,Math.min(255,tint<0?n*(1+tint):n+(255-n)*tint))).toString(16).padStart(2,'0');}).join('');
    return `#${hex}`;
  };
  const fills=tags(block(xml,'fills'),'fill').map(m=>{const pat=tags(m[2],'patternFill')[0];return attr(pat?.[1],'patternType')==='solid'?color(tags(pat?.[2],'fgColor')[0]?.[1]):null;});
  const fonts=tags(block(xml,'fonts'),'font').map(m=>({color:color(tags(m[2],'color')[0]?.[1]),bold:tags(m[2],'b').some(x=>attr(x[1],'val')!=='0'),italic:tags(m[2],'i').some(x=>attr(x[1],'val')!=='0')}));
  return tags(block(xml,'cellXfs'),'xf').map(m=>({fill:fills[+attr(m[1],'fillId')],...fonts[+attr(m[1],'fontId')],align:attr(tags(m[2],'alignment')[0]?.[1],'horizontal'),wrap:attr(tags(m[2],'alignment')[0]?.[1],'wrapText')==='1'}));
}
export function sheetAppearance(xml, styles) {
  const cellStyles={}, columnStyles={}, rowStyles={}, columnWidths={}, merges=[];
  for(const m of tags(xml,'c')) {const ref=attr(m[1],'r'), id=attr(m[1],'s');if(ref && id!=null) cellStyles[ref]=styles[+id] || {};}
  for(const m of tags(xml,'row')) {const id=attr(m[1],'s');if(id!=null)rowStyles[+attr(m[1],'r')-1]=styles[+id] || {};}
  for(const m of tags(xml,'col')) for(let c=+attr(m[1],'min')-1;c<Math.min(16384,+attr(m[1],'max'));c++) {
    const id=attr(m[1],'style');if(id!=null)columnStyles[c]=styles[+id]||{};
    const width=Number(attr(m[1],'width'));if(width>0)columnWidths[c]=Math.min(420,Math.max(56,width*7+5));
  }
  for(const m of tags(xml,'mergeCell')) {const ref=attr(m[1],'ref');if(/^[A-Z]+\d+:[A-Z]+\d+$/.test(ref || ''))merges.push(ref);}
  return {cellStyles,columnStyles,rowStyles,columnWidths,merges,defaultStyle:styles[0] || {}};
}
