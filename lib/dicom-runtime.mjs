// Loaded only when local DICOM files are selected. All scripts/codecs are bundled.
let ready;
export function dicomRuntime() {
  return ready ||= (async()=>{
    const base=new URL('../assets/dicom/',import.meta.url);
    for(const name of ['cornerstone.min.js','dicomParser.min.js','hammer.min.js','cornerstoneMath.min.js','cornerstoneTools.min.js','cornerstoneWADOImageLoader.bundle.min.js']){
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(name,base).href;script.onload=resolve;script.onerror=()=>reject(new Error('DICOM runtime could not load'));document.head.append(script);});
    }
    const cs=window.cornerstone,tools=window.cornerstoneTools,loader=window.cornerstoneWADOImageLoader;
    loader.external.cornerstone=cs;loader.external.dicomParser=window.dicomParser;
    loader.webWorkerManager.initialize({maxWebWorkers:Math.min(2,navigator.hardwareConcurrency||1),startWebWorkersOnDemand:true,webWorkerTaskPaths:[],taskConfiguration:{decodeTask:{initializeCodecsOnStartup:false,strict:false}}});
    tools.external.cornerstone=cs;tools.external.cornerstoneMath=window.cornerstoneMath;tools.external.Hammer=window.Hammer;
    tools.init({showSVGCursors:false});cs.imageCache.setMaximumSizeBytes(128*1024*1024);
    return {cs,tools,loader,parser:window.dicomParser};
  })().catch(err=>{ready=null;throw err;});
}
export function sliceOrder(meta){const p=(meta.position||'').split('\\').map(Number),o=(meta.orientation||'').split('\\').map(Number);if(p.length===3&&o.length===6&&[...p,...o].every(Number.isFinite))return p[0]*(o[1]*o[5]-o[2]*o[4])+p[1]*(o[2]*o[3]-o[0]*o[5])+p[2]*(o[0]*o[4]-o[1]*o[3]);return Number(meta.instance)||0;}
