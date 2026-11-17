// The one gate on the late abstracts (store.mjs sets it): whenReady() is null once they are on the records, else a promise that
// waits (rejects when they cannot be read). Every model run, inbox, workflow, export and baseline goes through it; it names no store,
// so the Node tools import it too (nothing defers there). app/test/abstracts-late.test.mjs lists the call sites.
let wait = () => null;
export const whenReady = () => wait();
export const setAbstractsWait = fn => { wait = fn; };
