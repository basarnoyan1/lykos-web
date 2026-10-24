import { parseDatasetBytes } from './dataset-import.mjs';
self.onmessage = async ({ data }) => {
  try { const datasets = await parseDatasetBytes(new Uint8Array(data.buffer), data.name, { onProgress: progress => self.postMessage({ progress }) }); self.postMessage({ datasets }); }
  catch (error) { self.postMessage({ error: String(error.message || error) }); }
};
