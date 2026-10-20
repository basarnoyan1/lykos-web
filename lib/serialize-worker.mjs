self.onmessage = e => {
  try { self.postMessage({ text: JSON.stringify(e.data) }); }
  catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
