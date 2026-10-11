// One controller belongs to one editor. Its save callback owns the request and
// saved snapshot; every draft save and publish must use this same queue.
export function createAutosave({ save, isDirty, onState = () => {}, delay = 1000 }) {
  if (typeof save !== 'function' || typeof isDirty !== 'function') throw new TypeError('save and isDirty callbacks are required');

  let timer = null, ready = false, active = null, disposed = false, lastError = null;
  let state = { status: isDirty() ? 'pending' : 'saved', error: null };
  const requests = [];

  function report(status, error = null) {
    if (disposed) return;
    state = { status, error };
    onState({ ...state });
  }
  function clearBackground() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    ready = false;
  }
  function abortError() {
    const error = new Error('This editor has been closed');
    error.name = 'AbortError';
    return error;
  }
  function start(request) {
    clearBackground();
    lastError = null;
    active = request;
    report('saving');
    // Set active before invoking save: synchronous callbacks can safely schedule
    // another edit without starting a competing request.
    (async () => {
      try {
        const result = await save(request.options);
        active = null;
        request.resolve?.(result);
        if (!disposed) pump();
      } catch (error) {
        active = null;
        // Publishing can fail after its draft PUT succeeded. The explicit
        // operation still rejects, but that failure must not block later draft
        // edits when the current content is already safely saved.
        const unsaved = isDirty();
        lastError = unsaved ? error : null;
        clearBackground();
        request.reject?.(error);
        // A queued click made before this failure is not a retry decision.
        for (const waiting of requests.splice(0)) waiting.reject(error);
        report(unsaved ? 'error' : 'saved', lastError);
      }
    })();
  }
  function pump() {
    if (disposed || active) return;
    while (requests.length) {
      const request = requests.shift();
      if (!request.force && !isDirty()) { request.resolve(false); continue; }
      start(request);
      return;
    }
    if (lastError) { report('error', lastError); return; }
    if (!isDirty()) { clearBackground(); report('saved'); return; }
    if (ready) { start({ options: { automatic: true } }); return; }
    if (timer === null) arm();
    report('pending');
  }
  function arm() {
    timer = setTimeout(() => { timer = null; ready = true; pump(); }, delay);
  }
  function schedule() {
    if (disposed) return;
    if (lastError && isDirty()) { report('error', lastError); return; }
    clearBackground();
    if (!isDirty()) {
      lastError = null;
      if (!active) report('saved');
      return;
    }
    arm();
    report(active ? 'saving' : 'pending');
  }
  function flush({ force = false, ...options } = {}) {
    if (disposed) return Promise.reject(abortError());
    clearBackground();
    lastError = null;
    const promise = new Promise((resolve, reject) => {
      requests.push({ options: { ...options, automatic: false }, force, resolve, reject });
    });
    pump();
    return promise;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearBackground();
    for (const request of requests.splice(0)) request.reject(abortError());
  }
  return {
    schedule,
    flush,
    retry: () => flush({ force: true }),
    dispose,
    get state() { return { ...state }; },
  };
}
