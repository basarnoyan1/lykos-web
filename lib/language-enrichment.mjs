import { store$get as get, store$update as update, store$projects as projects } from "../boot.mjs";
import { lib_native$inDesktop as inDesktop } from "../boot.mjs";
import { lookupPaperLanguages } from './sources.mjs';
import { storedLanguage } from './languages.mjs';
const pending = new Set(), retryAfter = new Map();
export async function ensurePaperLanguages(onChange = () => {}) {
  if (!inDesktop()) return;
  const project = projects().current;
  if (pending.has(project) || (retryAfter.get(project) || 0) > Date.now()) return;
  pending.add(project);
  let changed = false;
  try {
    const unknown = get().papers.filter(p => !p.language && (!p.languageCheckedAt || Date.now()-p.languageCheckedAt > 7*86400000));
    for (let i=0; i<unknown.length; i+=20) {
      if (projects().current !== project) return;
      const batch = unknown.slice(i,i+20).map(p => ({...p}));
      const local = batch.filter(p => storedLanguage(p)).map(p => ({id:p.id,language:storedLanguage(p)}));
      const remote = await lookupPaperLanguages(batch.filter(p => !storedLanguage(p)));
      if (projects().current !== project) return;
      const found = new Map([...remote,...local].map(x => [x.id,x.language]));
      // a batch's records by id (a find per record walked every record of the library: 20 x 26,000 a batch); the language is not in the project index
      update(s => { const byId = new Map(batch.map(b => [b.id, null])); for (const x of s.papers) if (byId.has(x.id)) byId.set(x.id, x);
        for (const original of batch) {
        const p=byId.get(original.id);
        if (!p || p.language || p.doi!==original.doi || p.pmid!==original.pmid || p.url!==original.url) continue;
        const language=found.get(p.id);
        if (language) { changed=true; p.language=language; p.languageSource=local.some(x=>x.id===p.id)?'Imported metadata':'Europe PMC'; }
        p.languageCheckedAt=Date.now();
      } return s; }, { indexNeutral: true });
    }
  } catch (error) { retryAfter.set(project,Date.now()+5*60000); console.warn('Language lookup:',error.message); }
  finally { pending.delete(project); if (changed && projects().current === project) onChange(); }
}
