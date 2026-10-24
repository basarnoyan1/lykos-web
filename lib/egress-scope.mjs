// Changing what a connection may receive (plan §3.2): the choice is saved on the connection's profile, beside its endpoint and key, with the host it was
// made for. Apart from lib/egress.mjs, which every send loads, because saving a profile reaches the settings store and the page's dialogs.
import { profiles, setProfiles } from './model-settings.mjs';
import { CLASSES, hostOfCfg, sendsOf } from './egress.mjs';

/** Saves which classes a connection may receive, with the host that choice is for. Returns false when no such connection is saved. */
export function setSends(profileId, classes) {
  const list = profiles(), p = list.find(x => x.id === profileId);
  if (!p) return false;
  setProfiles(list.map(x => (x.id === profileId ? { ...x, sends: { host: hostOfCfg(x), classes: CLASSES.filter(c => classes.includes(c)) } } : x)));
  return true;
}
/** Allows more classes on a connection (the answer to a preview that asked). */
export const allowClasses = (cfg, classes) => setSends(cfg.id, [...sendsOf(cfg), ...classes]);
