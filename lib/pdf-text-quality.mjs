// A scan can carry selectable download stamps or a page number without a
// usable article text layer. Length alone must not erase a valid short page.
const position = i => {
  const [x,y] = i.transform ? [i.transform[4],i.transform[5]] : [i.x,i.y];
  const angle = i.transform ? Math.atan2(i.transform[1],i.transform[0]) : i.angle || 0;
  const w = i.width ?? i.w ?? 0, h = i.height ?? i.h ?? 0;
  // Use a run's centre: normal body text commonly starts at the left margin.
  return [x+Math.cos(angle)*w/2-Math.sin(angle)*h/2,y+Math.sin(angle)*w/2+Math.cos(angle)*h/2];
};
const margin = (i, view) => {
  const [x, y] = position(i), [x0, y0, x1, y1] = view;
  return Number.isFinite(x) && Number.isFinite(y) &&
    (x < x0 + (x1 - x0) * .09 || x > x1 - (x1 - x0) * .09 || y < y0 + (y1 - y0) * .08 || y > y1 - (y1 - y0) * .08);
};

export function textLayerQuality(content, { view = [0, 0, 612, 792], imageCoverage = 0 } = {}) {
  const items = (Array.isArray(content) ? content : content?.items || []).filter(i => i.str?.trim());
  const text = items.map(i => i.str.trim()).join(' '), characters = text.length;
  const allMargin = items.length > 0 && items.every(i => margin(i, view));
  const downloadStamp = /Downloaded\s+from/i.test(text) && /https?:\/\/|academic\.oup\.com|journals?\.[a-z]/i.test(text);
  const reason = !characters ? 'empty' : allMargin && characters < 600 && downloadStamp ? 'download-watermark' :
    allMargin && characters < 120 && imageCoverage >= .25 ? 'image-with-margin-text' : 'native';
  return { reason, needsOcr: reason !== 'native', characters, imageCoverage, reviewRequired: reason !== 'native' };
}

const mul = (m, n) => [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
/** Largest painted image's clipped bounding area; a screening hint, not segmentation. */
export function pageImageCoverage(list, OPS, view) {
  let matrix = [1,0,0,1,0,0], largest = 0; const stack = [];
  const paint = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter(x => x != null);
  for (let k = 0; k < list.fnArray.length; k++) {
    const fn = list.fnArray[k], args = list.argsArray[k];
    if (fn === OPS.save) stack.push(matrix);
    else if (fn === OPS.restore) matrix = stack.pop() || matrix;
    else if (fn === OPS.transform) matrix = mul(matrix, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(matrix); if (args?.[0]) matrix = mul(matrix,args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) matrix = stack.pop() || matrix;
    else if (paint.includes(fn)) {
      const pts = [[0,0],[1,0],[0,1],[1,1]].map(([x,y]) => [matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const w = Math.max(0,Math.min(view[2],Math.max(...xs))-Math.max(view[0],Math.min(...xs)));
      const h = Math.max(0,Math.min(view[3],Math.max(...ys))-Math.max(view[1],Math.min(...ys)));
      largest = Math.max(largest,w*h/((view[2]-view[0])*(view[3]-view[1])));
    }
  }
  return Math.min(1, largest);
}

export async function pageTextQuality(page, content, OPS) {
  const basic = textLayerQuality(content,{view:page.view});
  if (basic.needsOcr || basic.characters >= 120 || !OPS) return basic;
  // Only sparse margin-only pages need the relatively expensive image check.
  if (!(content?.items || []).filter(i => i.str?.trim()).every(i => margin(i,page.view))) return basic;
  const list = await page.getOperatorList().catch(() => null);
  return list ? textLayerQuality(content,{view:page.view,imageCoverage:pageImageCoverage(list,OPS,page.view)}) : basic;
}

export function selectTextLayer(native, recognised, quality) {
  return quality.needsOcr && recognised?.items?.some(i => i.str?.trim()) ? recognised : native;
}
