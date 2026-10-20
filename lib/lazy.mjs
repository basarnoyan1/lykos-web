// A module that loads when it is first needed (footprint Task 6): one memoised dynamic import, with the same shape for every use.
//   const aidish = lazyModule(() => import('./x.mjs'), 'the x tools');
//   const { fn } = await aidish.ensure();   // loads once; callers in flight share the one import
//   aidish.ready()  -> true once it is here; aidish.module() -> the namespace, or null (for a reader that must not wait)
// A failed import is not kept, so the next caller tries again; it fails with a message that names what could not load (`cause` is the original
// error), which the caller shows where it would have shown its own failure. The import itself stays an arrow in the caller's file so that the
// build and the dev server see a literal specifier.
export function lazyModule(load, what) {
  let loading = null, loaded = null;
  return {
    ready: () => loaded !== null,
    module: () => loaded,
    ensure() {
      return loading ||= Promise.resolve().then(load).then(m => (loaded = m), err => {
        loading = null;
        throw new Error(`Could not load ${what}: ${err?.message || err}`, { cause: err });
      });
    },
  };
}
