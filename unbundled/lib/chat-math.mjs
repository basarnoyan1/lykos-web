// Chat replies as HTML: a small, inert Markdown and LaTeX subset. The text is
// escaped first and markup is added afterwards; nothing the model writes is
// evaluated or passed through as HTML. Code, escapes and math are lifted out
// before any block or emphasis rule runs, so a `*` or `_` inside $x_i^*$ or a
// code span cannot turn into italics, and an unbalanced delimiter degrades to
// the text as written — never an exception and never missing text.
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---- math -------------------------------------------------------------------
const symbols = {
 circ:'°',degree:'°',times:'×',cdot:'·',cdots:'⋯',ldots:'…',dots:'…',div:'÷',ast:'∗',star:'⋆',bullet:'•',prime:'′',
 pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',lt:'&lt;',gt:'&gt;',ll:'≪',gg:'≫',ne:'≠',neq:'≠',approx:'≈',sim:'∼',simeq:'≃',
 cong:'≅',equiv:'≡',propto:'∝',infty:'∞',to:'→',rightarrow:'→',leftarrow:'←',Rightarrow:'⇒',Leftarrow:'⇐',
 leftrightarrow:'↔',Leftrightarrow:'⇔',iff:'⇔',implies:'⇒',mid:'|',vert:'|',Vert:'‖',
 alpha:'α',beta:'β',gamma:'γ',Gamma:'Γ',delta:'δ',Delta:'Δ',epsilon:'ε',varepsilon:'ε',zeta:'ζ',eta:'η',theta:'θ',
 Theta:'Θ',iota:'ι',kappa:'κ',lambda:'λ',Lambda:'Λ',mu:'μ',nu:'ν',xi:'ξ',Xi:'Ξ',pi:'π',Pi:'Π',rho:'ρ',sigma:'σ',
 Sigma:'Σ',tau:'τ',upsilon:'υ',phi:'φ',varphi:'φ',Phi:'Φ',chi:'χ',psi:'ψ',Psi:'Ψ',omega:'ω',Omega:'Ω',
 sum:'∑',prod:'∏',int:'∫',in:'∈',notin:'∉',ni:'∋',subset:'⊂',subseteq:'⊆',cup:'∪',cap:'∩',emptyset:'∅',varnothing:'∅',
 forall:'∀',exists:'∃',neg:'¬',land:'∧',lor:'∨',partial:'∂',nabla:'∇',angle:'∠',therefore:'∴',because:'∵',
 langle:'⟨',rangle:'⟩',lfloor:'⌊',rfloor:'⌋',lceil:'⌈',rceil:'⌉',
};
// Written upright, as their names: \log x reads "log x".
const operators = new Set(['log','ln','exp','sin','cos','tan','max','min','lim','sup','inf','arg','det','var','Var','Pr','logit','mod']);
const accents = { hat:'̂', widehat:'̂', bar:'̄', overline:'̄', tilde:'̃', widetilde:'̃', dot:'̇', ddot:'̈', vec:'⃗' };
const styles = new Set(['text','textrm','textnormal','mathrm','operatorname','mathbf','textbf','boldsymbol','bm','mathit','textit','emph','mathsf','mathcal','mathbb','mbox','displaystyle','textstyle']);
const blackboard = { R:'ℝ', N:'ℕ', Z:'ℤ', Q:'ℚ', C:'ℂ', E:'𝔼', P:'ℙ' };
const combine = (html, mark) => html.replace(/(&[a-z#0-9]+;|[^<>&](?![^<]*>))/g, m => m + mark);

export function renderChatMath(source, display = false) {
 let pos=0, depth=0;source=String(source).slice(0,4000);
 const skipSpace=()=>{while(source[pos]===' '||source[pos]==='\n')pos++;};
 function atom() {
  if(pos>=source.length)return '';
  const c=source[pos++];
  if(c==='{')return group();
  if(c==='}')return '';
  if(c==='&')return ' ';
  if(c==='~')return ' ';
  if(c==='\n')return ' ';
  if(c==='\\') {
   const command=source.slice(pos).match(/^[a-zA-Z]+/);
   if(!command){
    const literal=source[pos++]||'';
    if(literal==='\\')return display?'<br>':' ';
    if(literal==='|')return '‖';
    return /[,;:! >]/.test(literal)?' ':escape(literal);
   }
   const name=command[0];pos+=name.length;
   if(name in symbols)return symbols[name];
   if(operators.has(name))return name;
   if(name==='left'||name==='right'||name==='big'||name==='Big'||name==='bigl'||name==='bigr'||name==='Bigl'||name==='Bigr'){skipSpace();if(source[pos]==='.')pos++;return '';}
   if(name==='quad'||name==='qquad')return ' ';
   if(name==='begin'||name==='end'){skipSpace();if(source[pos]==='{'){pos++;group();}return name==='begin'?'':' ';}
   if(name==='mathbb'){skipSpace();const content=atom();return blackboard[content]||content;}
   if(styles.has(name)) {
    skipSpace();if(name==='displaystyle'||name==='textstyle')return '';
    const content=atom();
    return ['mathbf','textbf','boldsymbol','bm'].includes(name)?`<b>${content}</b>`:['mathit','textit','emph'].includes(name)?`<i>${content}</i>`:content;
   }
   if(name in accents){skipSpace();return combine(atom(),accents[name]);}
   if(name==='frac'||name==='dfrac'||name==='tfrac'||name==='cfrac'){skipSpace();const a=atom();skipSpace();const b=atom();return `<span class="chat-frac"><span>${a}</span><span>${b}</span></span>`;}
   if(name==='binom'){skipSpace();const a=atom();skipSpace();const b=atom();return `(${a} choose ${b})`;}
   if(name==='sqrt') {
    skipSpace();let index='';
    if(source[pos]==='['){const close=source.indexOf(']',pos);if(close>pos){index=renderChatMath(source.slice(pos+1,close)).replace(/^<span class="chat-math">|<\/span>$/g,'');pos=close+1;}}
    skipSpace();return `${index?`<sup>${index}</sup>`:''}√(${atom()})`;
   }
   // Unsupported commands stay visible; never silently invent a meaning.
   return escape('\\'+name);
  }
  if(c==='^'||c==='_') {
   skipSpace();const value=atom();if(c==='^'&&value==='°')return '°';
   if(c==='^'&&/^′+$/.test(value))return value;
   const tag=c==='^'?'sup':'sub';return `<${tag}>${value}</${tag}>`;
  }
  if(c==="'")return '′';
  return escape(c);
 }
 function group() {
  if(++depth>20){pos=source.length;return '';}
  let result='';while(pos<source.length&&source[pos]!=='}')result+=atom();
  if(source[pos]==='}')pos++;depth--;return result;
 }
 let body='';while(pos<source.length)body+=atom();
 return `<span class="chat-math${display?' chat-math-display':''}">${body.trim()}</span>`;
}

// ---- markdown ---------------------------------------------------------------
// Placeholders use private-use characters, which neither escaping nor the
// emphasis patterns touch: \uE000n\uE001 for inline HTML, \uE002n\uE003 for a
// code block that stands on its own line.
const INLINE = (n) => `\uE000${n}\uE001`;
const BLOCK = (n) => `\uE002${n}\uE003`;
const PUNCT = '!"#%&\'()*+,-./:;<=>?@[]^_`{|}~\\$';

/** Fenced code blocks out first: nothing inside them is Markdown or math. */
function liftFences(text, blocks) {
 const lines = text.split('\n'), out = [];
 for (let i = 0; i < lines.length; i++) {
  const open = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/);
  if (!open) { out.push(lines[i]); continue; }
  const fence = open[2], indent = open[1].length, body = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
   const close = lines[j].match(/^\s*(`{3,}|~{3,})\s*$/);
   if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
   body.push(lines[j].slice(Math.min(indent, lines[j].match(/^\s*/)[0].length)));
  }
  blocks.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
  out.push(`${open[1]}${BLOCK(blocks.length - 1)}`);
  i = j;   // an unclosed fence runs to the end, as in CommonMark
 }
 return out.join('\n');
}

/**
 * One left-to-right pass that lifts escapes, code spans and math. Delimiters:
 * $…$ and \(…\) inline; $$…$$ and \[…\] display (may span lines). A single $
 * opens math only when a non-space follows it, and closes only after a
 * non-space and before a non-digit, so "$5 and $10" stays two prices.
 */
function liftInline(text, store) {
 let out = '', i = 0;
 // No delimiter pairs across a blank line: a stray $ or backtick in one
 // paragraph never swallows the next.
 const para = body => !/\n[ \t]*\n/.test(body);
 const keep = html => { store.push(html); return INLINE(store.length - 1); };
 while (i < text.length) {
  const c = text[i];
  if (c === '\\') {
   const next = text[i + 1];
   if (next === '(' || next === '[') {
    const close = text.indexOf(next === '(' ? '\\)' : '\\]', i + 2);
    const body = close > 0 ? text.slice(i + 2, close) : '';
    if (close > 0 && body.trim() && para(body) && close - i < 4000) { out += keep(renderChatMath(body, next === '[')); i = close + 2; continue; }
    out += keep(escape(c + next)); i += 2; continue;
   }
   if (next && PUNCT.includes(next)) { out += keep(escape(next)); i += 2; continue; }
   out += c; i++; continue;
  }
  if (c === '`') {
   const run = text.slice(i).match(/^`+/)[0];
   let j = i + run.length, found = -1;
   while ((j = text.indexOf(run, j)) >= 0) {
    if (text[j + run.length] !== '`' && text[j - 1] !== '`') { found = j; break; }
    j += run.length;
   }
   if (found > 0 && para(text.slice(i, found))) {
    let code = text.slice(i + run.length, found).replace(/\n/g, ' ');
    if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
    out += keep(`<code>${escape(code)}</code>`); i = found + run.length; continue;
   }
   out += keep(escape(run)); i += run.length; continue;
  }
  if (c === '$') {
   if (text[i + 1] === '$') {
    const close = text.indexOf('$$', i + 2), body = close > 0 ? text.slice(i + 2, close) : '';
    if (close > 0 && body.trim() && para(body) && close - i < 4000) { out += keep(renderChatMath(body, true)); i = close + 2; continue; }
    out += keep('$$'); i += 2; continue;
   }
   const close = text.indexOf('$', i + 1), body = close > 0 ? text.slice(i + 1, close) : '';
   const ok = close > 0 && !/\n/.test(body) && body.length <= 1000 && /^\S/.test(body) && /\S$/.test(body)
     && !/\d/.test(text[close + 1] || '')
     // A bare figure is a price ("$5,$10") unless it is a decimal estimate written as math ("$0.82$").
     && (!/^\d[\d,.]*(?:\s|$)/.test(body) || /^\d+\.\d+$/.test(body));
   if (ok) { out += keep(renderChatMath(body)); i = close + 1; continue; }
   out += keep('$'); i++; continue;
  }
  out += c; i++;
 }
 return out;
}

function inlineHtml(s, store) {
 const restore = t => t.replace(/\uE000(\d+)\uE001/g, (_, n) => store[+n] ?? '');
 // Links first, held aside: emphasis must not reach into an address, and an
 // address stops at a placeholder or a quote, so it never leaves its href.
 return escape(s)
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()"<>\uE000-\uE004]+)\)/g, (_, text, href) => `\uE000${store.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${restore(text)}</a>`) - 1}\uE001`)
  .replace(/\*\*\*(?!\s)([^*]+?)(?<!\s)\*\*\*/g, '<b><i>$1</i></b>')
  .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<b>$1</b>')
  .replace(/(?<![\w_])__(?!\s)([^_]+?)(?<!\s)__(?![\w_])/g, '<b>$1</b>')
  .replace(/(?<![\w*])\*(?![\s*])([^*]*?[^\s*])\*(?![\w*])/g, '<i>$1</i>')
  .replace(/(?<![\w_])_(?![\s_])([^_]*?[^\s_])_(?![\w_])/g, '<i>$1</i>')
  .replace(/~~(?!\s)([^~]+?)(?<!\s)~~/g, '<s>$1</s>')
  .replace(/\uE000(\d+)\uE001/g, (_, n) => store[+n] ?? '');
}

const TABLE_RULE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());

function blocksHtml(lines, store, blocks, depth = 0) {
 const out = [], stack = [];
 let para = [], blank = false;
 const inline = s => inlineHtml(s, store);
 // Lines of one paragraph join with a space, except that a line opening with
 // a bold label ("**Population:** adults") starts a new line.
 const joined = list => inline(list.map((l, k) => k === 0 ? l : /^\*\*[^*]+\*\*/.test(l) ? `\uE004${l}` : ` ${l}`).join('')).replace(/\uE004/g, '<br>');
 const flushPara = () => { if (para.length) { out.push(`<p>${joined(para)}</p>`); para = []; } };
 const closeLists = () => { stack.length = 0; };
 const itemOf = entry => entry.list.items.at(-1);
 const renderList = list => `<${list.tag}${list.tag === 'ol' && list.start !== 1 ? ` start="${list.start}"` : ''}>${list.items.map(item =>
  `<li>${item.parts.map((part, k) => part.list ? renderList(part.list) : part.html != null ? part.html
   : k === 0 ? joined(part.lines) : `<p>${joined(part.lines)}</p>`).join('')}</li>`).join('')}</${list.tag}>`;
 const addText = (item, line, fresh) => {
  const last = item.parts.at(-1);
  if (!fresh && last?.lines) last.lines.push(line); else item.parts.push({ lines: [line] });
 };
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i], line = raw.trim();
  const indent = Math.min(80, raw.match(/^\s*/)[0].replace(/\t/g, '    ').length);
  if (!line) { flushPara(); blank = true; continue; }
  const code = line.match(/^\uE002(\d+)\uE003$/);
  if (code) {
   const html = blocks[+code[1]];
   if (stack.length && indent > stack[0].indent) {
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    itemOf(stack.at(-1)).parts.push({ html });
   } else { flushPara(); closeLists(); out.push(html); }
   blank = false; continue;
  }
  const head = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
  if (head) { flushPara(); closeLists(); out.push(`<p class="md-heading"><b>${inline(head[2])}</b></p>`); blank = false; continue; }
  if (/^([-*_])(\s*\1){2,}$/.test(line)) {
    // A rule is a separator the reply does not need; in chat "Text\n---" is
   // far more often a separator than a setext heading.
   flushPara(); closeLists();
   blank = false; continue;
  }
  if (/^=+$/.test(line) && para.length && !stack.length) { const text = joined(para); para = []; out.push(`<p class="md-heading"><b>${text}</b></p>`); blank = false; continue; }
  // Quotes nest to a readable depth; deeper markers are text, so a reply of
  // thousands of ">" cannot exhaust the stack and break the chat on every repaint.
  if (line.startsWith('>') && depth < 8 && !(stack.length && indent > stack[0].indent)) {
   flushPara(); closeLists();
   const quoted = [];
   for (; i < lines.length && lines[i].trim().startsWith('>'); i++) quoted.push(lines[i].trim().replace(/^>\s?/, ''));
   i--;
   out.push(`<blockquote>${blocksHtml(quoted, store, blocks, depth + 1)}</blockquote>`);
   blank = false; continue;
  }
  if (line.includes('|') && TABLE_RULE.test((lines[i + 1] || '').trim())) {
   const header = cells(line), width = header.length;
   if (cells(lines[i + 1]).length === width && (width > 1 || line.startsWith('|'))) {
    flushPara(); closeLists();
    const rows = [];
    for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
    i--;
    const fit = row => Array.from({ length: width }, (_, k) => row[k] ?? '');
    out.push(`<div class="chat-table-wrap" tabindex="0"><table><thead><tr>${header.map(x => `<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${fit(r).map(x => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    blank = false; continue;
   }
  }
  const marker = line.match(/^(?:([-*+•])|(\d{1,9})[.)])\s+(.*)$/);
  // A wrapped sentence that begins "2019. The cohort…" is not a list: outside
  // a list only "1." (or a bullet) may interrupt a paragraph.
  const startsList = marker && !(para.length && !stack.length && marker[2] && marker[2] !== '1');
  if (startsList) {
   flushPara(); const tag = marker[1] ? 'ul' : 'ol';
   while (stack.length && stack.at(-1).indent > indent) stack.pop();
   if (stack.at(-1)?.indent === indent && stack.at(-1).list.tag !== tag) stack.pop();
   if (!stack.length || stack.at(-1).indent < indent) {
    const list = { tag, start: Number(marker[2]) || 1, items: [] };
    if (stack.length) itemOf(stack.at(-1)).parts.push({ list }); else out.push(list);
    stack.push({ indent, list });
   }
   stack.at(-1).list.items.push({ parts: [{ lines: [marker[3]] }] }); blank = false; continue;
  }
  if (stack.length && !blank) addText(itemOf(stack.at(-1)), line, false);
  else if (stack.length && indent > stack[0].indent) {
   while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
   addText(itemOf(stack.at(-1)), line, true);
  } else { closeLists(); para.push(line); }
  blank = false;
 }
 flushPara();
 return out.map(block => typeof block === 'string' ? block : renderList(block)).join('');
}

/**
 * A model reply as HTML: paragraphs, headings, nested and numbered lists,
 * tables, block quotes, code, emphasis, http(s) links and math.
 */
export function renderChatMarkdown(text) {
 const store = [], blocks = [];
 const source = String(text || '').replace(/\r\n?/g, '\n').replace(/[\uE000-\uE004]/g, '');
 const lifted = liftInline(liftFences(source, blocks), store);
 return blocksHtml(lifted.split('\n'), store, blocks);
}

/** One line of reply text — a table cell, say — with inline markup and math only. */
export function renderChatInline(text) {
 const store = [];
 const source = String(text ?? '').replace(/[\uE000-\uE004]/g, '').replace(/\s*\n\s*/g, ' ');
 return inlineHtml(liftInline(source, store), store);
}
