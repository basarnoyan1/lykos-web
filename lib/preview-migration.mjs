import { get, update } from '../store.mjs';
import { getHandle, forget } from './files.mjs';
import { readFileNative } from './native.mjs';
export async function retireSavedRetrievals() {
  const review = get(), receipts = new Map();
  for (const p of [...review.papers]) {
    if (!p.pdf) continue;
    const handle = await getHandle(p.id).catch(() => null);
    let receipt = null;
    if (handle?.path) {
      const dir = handle.path.replace(/\/[^/]*$/, '');
      if (!receipts.has(dir)) {
        let data; try { data = JSON.parse(new TextDecoder().decode(await readFileNative(`${dir}/manifest.json`))); } catch {}
        receipts.set(dir, data?.format === 'lykos-paper-downloads-1' ? data.files : []);
      }
      receipt = receipts.get(dir)?.find(x => x.id === p.id && x.file === handle.path.split('/').pop() && x.sha256?.startsWith(p.pdfHash));
    }
    const generatedCopy = p.pdfMode === 'copy' && p.pdfRetrieval?.status === 'available';
    if (!receipt && !generatedCopy) continue;
    if (get() !== review) return;
    await forget(p.id);
    if (get() !== review) return;
    update(s => {
      p.pdf = null;
      p.pdfRetrieval = { ...(p.pdfRetrieval || {}), ...(receipt ? { url: receipt.url, provider: receipt.provider } : {}), status: 'preview', error: '' };
      for (const k of ['pdfName','pdfMode','pdfSize','pdfHash']) delete p[k];
      return s;
    });
  }
}
