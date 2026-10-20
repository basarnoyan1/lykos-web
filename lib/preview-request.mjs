import { retrievePaperNative, cancelPaperRetrievalNative } from './native.mjs';
let nextRequestId = Date.now();
const aborted = () => Object.assign(new Error('Preview changed'), { name: 'AbortError' });

/** Only cancel this request; stale readers cannot cancel a newer paper. */
export async function requestPreview(request, {
  isWanted = () => true, requestImpl = retrievePaperNative,
  cancelImpl = cancelPaperRetrievalNative, intervalMs = 150,
} = {}) {
  if (!isWanted()) throw aborted();
  const requestId = ++nextRequestId;
  let cancelled = false;
  const timer = setInterval(() => {
    if (!cancelled && !isWanted()) {
      cancelled = true;
      Promise.resolve(cancelImpl(requestId)).catch(() => {});
    }
  }, intervalMs);
  try {
    const result = await requestImpl({ ...request, requestId });
    if (cancelled || !isWanted()) throw aborted();
    return result;
  } catch (error) {
    if (cancelled || !isWanted()) throw aborted();
    throw error;
  } finally { clearInterval(timer); }
}
