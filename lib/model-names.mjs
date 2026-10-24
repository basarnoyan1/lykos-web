// A model's id as its maker names it (owner, 2026-10-22: "convert the model names to readable ones when they have a known rule, like
// Claude Sonnet 5.5"). Only an id that follows a maker's known pattern is renamed, and the name keeps everything that tells two models
// apart (family, version, size, cloud); the id itself stays the setting and the tooltip. Anything else is shown as written.
const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
const words = s => s.split('-').map(w => (['mini', 'nano', 'latest', 'lite'].includes(w) ? w : cap(w))).join(' ');
const FAMILY = { gemma: 'Gemma', llama: 'Llama', qwen: 'Qwen', mistral: 'Mistral', deepseek: 'DeepSeek', glm: 'GLM', phi: 'Phi', gpt: 'GPT' };

export function modelName(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  const base = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;   // an OpenRouter id names its maker first
  let m;
  // claude-sonnet-5-5, claude-opus-4-1-20250805, claude-sonnet-4.5, claude-haiku-5-5-latest
  if ((m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?(?:-latest)?$/i.exec(base))) return `Claude ${cap(m[1].toLowerCase())} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  // the older order: claude-3-5-sonnet-20241022
  if ((m = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)(?:-\d{8})?(?:-latest)?$/i.exec(base))) return `Claude ${cap(m[3].toLowerCase())} ${m[1]}${m[2] ? `.${m[2]}` : ''}`;
  // gpt-5.2, gpt-4.1-mini, gpt-5-2025-08-07, gpt-5.1-codex-max
  if ((m = /^gpt-(\d+(?:\.\d+)?)((?:-[a-z]+)*?)(?:-\d{4}-\d{2}-\d{2})?$/i.exec(base))) return `GPT-${m[1]}${m[2] ? ` ${words(m[2].slice(1).toLowerCase())}` : ''}`;
  // gemini-2.5-pro, gemini-2.0-flash-lite
  if ((m = /^gemini-(\d+(?:\.\d+)?)-((?:pro|flash)(?:-lite)?)(?:-latest)?$/i.exec(base))) return `Gemini ${m[1]} ${words(m[2].toLowerCase())}`;
  // an Ollama tag: gemma4:31b-cloud, llama3.1:8b
  if ((m = /^([a-z]+)(\d+(?:\.\d+)?)?:(\d+(?:\.\d+)?)b(-cloud)?$/i.exec(base)) && FAMILY[m[1].toLowerCase()]) return `${FAMILY[m[1].toLowerCase()]}${m[2] ? ` ${m[2]}` : ''} ${m[3]}B${m[4] ? ' (cloud)' : ''}`;
  return raw;
}
