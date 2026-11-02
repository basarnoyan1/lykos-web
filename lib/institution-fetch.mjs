// Batch retrieval through the institution (31 Oct 2026): a record's DOI opened in a browser the person is signed in to (OpenAthens
// redirector, or doi.org over the library's VPN), the publisher's page read, its PDF found by the page's own citation_pdf_url or by a
// publisher rule, and fetched inside that page's session (fetch with credentials, so the cookies stay in the browser and nothing is
// copied out). This module is the part with no browser in it: the start address, the scripts run in the page, what a page is (an
// article, a sign-in, a bot check, a refusal), where its PDF is, and the pace per publisher. tools/papers-institution.mjs drives it.
//
// Never: typing a credential, answering a CAPTCHA or a bot check, a shadow library. A sign-in stops the run and asks the person to sign
// in once in that browser; a bot check pauses that publisher and is reported, never worked around.
import { openAthensLink } from './institution-access.mjs';

/** The first address for a record: through the OpenAthens redirector, or plain doi.org (`via` 'vpn': the library's network does the rest). */
export function startUrl(doi, { via = 'openathens', domain = '' } = {}) {
  const d = String(doi || '').trim();
  if (!d) return '';
  if (via === 'openathens') { if (!domain) throw new Error('No OpenAthens domain: set it in Settings › Literature access or pass --domain'); return openAthensLink(domain, d); }
  return `https://doi.org/${encodeURI(d)}`;
}

// ---- publishers: one group per DOI prefix (for pacing before the page is known) and per host (for the PDF rules)
const GROUPS = [
  ['elsevier', /^10\.1016\//, /(^|\.)(sciencedirect\.com|thelancet\.com|cell\.com|elsevier\.com|sciencedirectassets\.com|clinicalkey\.com)$/],
  ['wiley', /^10\.(1002|1111)\//, /(^|\.)wiley\.com$/],
  ['neurology', /^10\.1212\//, /(^|\.)neurology\.org$/],
  ['oup', /^10\.1093\//, /(^|\.)academic\.oup\.com$/],
  ['lww', /^10\.(1227|1097)\//, /(^|\.)(lww\.com|ovid\.com)$/],
  ['springer', /^10\.(1007|1038|1186)\//, /(^|\.)(springer\.com|nature\.com|biomedcentral\.com|springeropen\.com)$/],
  ['karger', /^10\.1159\//, /(^|\.)karger\.com$/],
  ['thieme', /^10\.1055\//, /(^|\.)thieme-connect\.(de|com)$/],
  ['tandf', /^10\.(1080|3109)\//, /(^|\.)tandfonline\.com$/],
  ['cambridge', /^10\.1017\//, /(^|\.)cambridge\.org$/],
  ['bmj', /^10\.1136\//, /(^|\.)bmj\.com$/],
  ['sage', /^10\.1177\//, /(^|\.)sagepub\.com$/],
  ['jama', /^10\.1001\//, /(^|\.)jamanetwork\.com$/],
  ['nejm', /^10\.1056\//, /(^|\.)nejm\.org$/],
  ['jns', /^10\.3171\//, /(^|\.)thejns\.org$/],
  ['frontiers', /^10\.3389\//, /(^|\.)frontiersin\.org$/],
  ['mdpi', /^10\.3390\//, /(^|\.)mdpi\.com$/],
];
export const groupOfDoi = doi => GROUPS.find(g => g[1].test(String(doi || '').toLowerCase()))?.[0] || 'other';
export const groupOfHost = host => GROUPS.find(g => g[2].test(String(host || '').toLowerCase()))?.[0] || 'other';

/** Seconds between two records of one publisher: ScienceDirect blocks after about a dozen quick requests (31 Oct 2026), so it is slower. */
export const GROUP_PACE = { elsevier: 25 };
/** How long a publisher rests after a bot check before it is tried once more (ScienceDirect let requests through again after about 15 min). */
export const BACKOFF_S = 15 * 60;

/**
 * The pace of a run: per publisher group the time its next record may start. `ready(group, now)` says when (0: now); `used(group, now)`
 * records an opening; `blocked(group, now)` rests the group for BACKOFF_S. Times in milliseconds.
 */
export function pacer({ pace = 6, groupPace = GROUP_PACE, backoff = BACKOFF_S } = {}) {
  const next = new Map(), rested = new Map();
  return {
    ready: (g, now) => Math.max(0, (next.get(g) || 0) - now),
    used(g, now) { next.set(g, Math.max(next.get(g) || 0, now + 1000 * Math.max(pace, groupPace[g] || 0))); },
    blocked(g, now) { const until = now + 1000 * backoff; next.set(g, until); rested.set(g, (rested.get(g) || 0) + 1); return until; },
    times: g => rested.get(g) || 0,
  };
}

// ---- the page
/** A script for the page: what it is, as JSON (address, type, title, citation_pdf_url, PDF-like links, a password field, its first text). */
export const PROBE_JS = `(function(){try{
var d=document,b=d.body,t=b?b.innerText:'';var m=d.querySelector('meta[name="citation_pdf_url"]');var doi=d.querySelector('meta[name="citation_doi"],meta[name="dc.identifier"],meta[name="DC.Identifier"]');
var L=[].slice.call(d.querySelectorAll('a[href]')).map(function(a){return {href:a.href,text:(a.innerText||a.getAttribute('aria-label')||a.title||'').trim().slice(0,60)}}).filter(function(a){return /pdf/i.test(a.href+' '+a.text)}).slice(0,60);
var pw=[].slice.call(d.querySelectorAll('input[type=password]')).some(function(i){return i.offsetParent!==null});
var f=[].slice.call(d.querySelectorAll('iframe[src]')).map(function(i){return i.src}).filter(function(s){return /captcha|challenge|turnstile/i.test(s)}).length>0;
return JSON.stringify({url:location.href,ready:d.readyState,type:d.contentType||'',title:d.title||'',cpdf:m?m.content:'',doi:doi?doi.content:'',links:L,password:pw,captcha:f,text:t.slice(0,4000)});
}catch(e){return JSON.stringify({error:String(e)})}})()`;

const has = (text, re) => re.test(String(text || ''));
const SIGNIN_HOSTS = /(^|\.)(login\.openathens\.net|my\.openathens\.net|wayfinder\.openathens\.net|connect\.openathens\.net|login\.microsoftonline\.com|accounts\.google\.com|okta\.com)$/i;
const SIGNIN_PATH = /\/(idp|adfs|cas\/login|saml2?\/|sso\/|shibboleth|oauth2?\/authorize|login\b)/i;
const CHALLENGE = /just a moment|attention required|verify you are (a )?human|are you a robot|checking your browser|press (&|and) hold|unusual traffic|captcha|there was a problem providing the content you requested|request blocked|access denied.{0,40}bot/i;
const NO_ACCESS = /you do not (currently )?have access|purchase (this )?(article|pdf|access)|buy (this )?article|rent this article|get access to (the )?full|access through your institution|subscribe to (this )?journal|log in to (view|access) (the )?full|pay ?per ?view|access options/i;
const NOT_FOUND = /doi not found|this doi cannot be found|page not found|404 not found|the requested (page|article) (could not|was not) (be )?found|error: not a doi/i;

/**
 * What a probed page is: 'pdf' (a PDF itself), 'signin' (an institutional or OpenAthens sign-in: the person signs in), 'challenge' (a bot
 * check: never answered), 'notfound', 'loading', or 'article' (a publisher page, perhaps one that refuses: `refuses` then).
 */
export function classifyPage(p) {
  if (!p || p.error) return { kind: 'loading' };
  let host = '', path = '';
  try { const u = new URL(p.url); host = u.hostname; path = u.pathname; if (!/^https?:$/.test(u.protocol)) return { kind: 'loading' }; } catch { return { kind: 'loading' }; }
  if (/pdf/i.test(p.type)) return { kind: 'pdf', host };
  if (has(p.title, CHALLENGE) || p.captcha || (has(p.text.slice(0, 600), CHALLENGE) && p.text.length < 3000)) return { kind: 'challenge', host };
  if (host === 'go.openathens.net' || host === 'doi.org' || p.ready !== 'complete') return { kind: 'loading', host };
  if (SIGNIN_HOSTS.test(host) || (p.password && (SIGNIN_PATH.test(path) || /sign ?in|log ?in|giriş/i.test(p.title))) || (/(^|\.)ku\.edu\.tr$/i.test(host) && p.password)) return { kind: 'signin', host };
  if (has(p.title, NOT_FOUND) || (p.text.length < 1500 && has(p.text, NOT_FOUND))) return { kind: 'notfound', host };
  return { kind: 'article', host, refuses: has(p.text, NO_ACCESS) };
}

const abs = (href, base) => { try { return new URL(href, base).href; } catch { return ''; } };
/** A PDF address that is not the article's own full PDF: a 2-page preview, an e-reader page, a supplement, a figure. */
const NOT_THE_PDF = /previewpdf|\/epdf\/|\/reader\/|mmc\d|suppl|supplementa|figure|ars\.els-cdn\.com|\/doi\/pdfplus\/.*\?|citation|\.ris\b/i;

/**
 * Where the article's PDF is, best first: [{ how: 'fetch' | 'click', url }]. 'click' is ScienceDirect's own View PDF link (a direct pdfft
 * address meets a bot check, the link does not); every other address is fetched inside the page's session.
 */
export function pdfCandidates(p, doi = '') {
  const out = [], seen = new Set(), add = (how, url) => { if (url && !seen.has(url) && !NOT_THE_PDF.test(url)) { seen.add(url); out.push({ how, url }); } };
  let u; try { u = new URL(p.url); } catch { return out; }
  const host = u.hostname, group = groupOfHost(host), d = String(doi || p.doi || '').trim(), links = (p.links || []).map(l => ({ ...l, href: abs(l.href, p.url) }));
  const sameSite = href => { try { return new URL(href).hostname.split('.').slice(-2).join('.') === host.split('.').slice(-2).join('.'); } catch { return false; } };
  if (/pdf/i.test(p.type)) add('fetch', p.url);
  if (group === 'elsevier' && /sciencedirect\.com$/.test(host)) {
    const pii = /\/pii\/([A-Z0-9]+)/i.exec(u.pathname)?.[1];
    // the article's own View PDF (the page also links related articles' PDFs, by their own PII)
    const own = pii && links.find(l => l.href.includes(`/pii/${pii}/pdf`));
    if (own) add('click', own.href);
    return out;
  }
  if (group === 'elsevier') { for (const l of links) if (/showPdf|\/pdfExtended\/|\/action\/showPdf/i.test(l.href)) add('fetch', l.href); }
  if (p.cpdf) add('fetch', abs(p.cpdf, p.url));
  const enc = d && encodeURIComponent(d), atypon = group === 'wiley' || group === 'neurology' || group === 'sage' || group === 'tandf' || group === 'nejm' || /\/doi\/(abs|full|10\.)/.test(u.pathname);
  if (d && atypon) { add('fetch', `${u.origin}/doi/pdfdirect/${d}`); add('fetch', `${u.origin}/doi/pdf/${d}`); }
  if (group === 'lww') {
    if (/\/fulltext\//.test(u.pathname)) add('fetch', `${u.origin}${u.pathname.replace('/fulltext/', '/pdf/')}`);
    for (const l of links) if (/ovid\.com\/jnls\/.+\/pdf\/|downloadpdf|pdfviewer/i.test(l.href)) add('fetch', l.href);
  }
  if (group === 'springer' && d && /springer\.com$/.test(host)) add('fetch', `${u.origin}/content/pdf/${d}.pdf`);
  if (group === 'jns' && /\/view\//.test(u.pathname)) add('fetch', `${u.origin}${u.pathname.replace('/view/', '/downloadpdf/view/')}`);
  if (group === 'cambridge') for (const l of links) if (/\/services\/aop-cambridge-core\/content\/view\/.+\.pdf/i.test(l.href)) add('fetch', l.href);
  if (group === 'thieme' && d) add('fetch', `${u.origin}/products/ejournals/pdf/${d}.pdf`);
  if (group === 'frontiers' && d) add('fetch', `${u.origin}/articles/${d}/pdf`);
  if (group === 'mdpi' && !/\/pdf$/.test(u.pathname)) add('fetch', `${u.origin}${u.pathname.replace(/\/$/, '')}/pdf`);
  // any other link that says it is this article's PDF: its DOI or its address in the link, on the same site
  for (const l of links) {
    const mine = (d && (l.href.toLowerCase().includes(d.toLowerCase()) || l.href.includes(enc))) || l.href.startsWith(`${u.origin}${u.pathname}`);
    if (sameSite(l.href) && mine && /pdf/i.test(l.href)) add('fetch', l.href);
  }
  return out.slice(0, 4);
}

/** A script for the page: fetch `url` with the page's cookies; the PDF kept as base64 in the page, its state in window.__lykosSt (JSON). */
export const fetchJs = url => `(function(){window.__lykosPdf='';window.__lykosSt=JSON.stringify({state:'start'});
fetch(${JSON.stringify(url)},{credentials:'include'}).then(function(r){var ct=r.headers.get('content-type')||'';return r.arrayBuffer().then(function(b){var u=new Uint8Array(b);
var pdf=u.length>4&&u[0]===37&&u[1]===80&&u[2]===68&&u[3]===70;if(!pdf){window.__lykosSt=JSON.stringify({state:'notpdf',status:r.status,type:ct,url:r.url,size:u.length});return}
if(u.length>${32 * 1024 * 1024}){window.__lykosSt=JSON.stringify({state:'large',size:u.length});return}
var s='';for(var i=0;i<u.length;i+=32768){s+=String.fromCharCode.apply(null,u.subarray(i,i+32768))}window.__lykosPdf=btoa(s);
window.__lykosSt=JSON.stringify({state:'done',status:r.status,type:ct,url:r.url,size:u.length,b64:window.__lykosPdf.length})})}).catch(function(e){window.__lykosSt=JSON.stringify({state:'error',error:String(e)})});return 'started'})()`;
/** The state of that fetch, and a slice of its base64. */
export const FETCH_STATE_JS = 'window.__lykosSt||""';
export const chunkJs = (from, size) => `(window.__lykosPdf||'').substr(${from},${size})`;
export const CLEAR_JS = "window.__lykosPdf='';window.__lykosSt='';'cleared'";
/** ScienceDirect: its own View PDF link followed in this tab (no new window). */
export const clickJs = url => `(function(){var a=[].slice.call(document.querySelectorAll('a[href]')).find(function(x){return x.href===${JSON.stringify(url)}});if(!a)return 'nolink';a.removeAttribute('target');a.click();return 'clicked'})()`;

/** The outcome words of a record, as the report names them. */
export const OUTCOMES = { got: 'got', signin: 'needs sign-in', noaccess: 'no subscription', blocked: 'bot-blocked', notfound: 'not found', skipped: 'not tried' };
