// Rulers use the rendered page geometry, including each section's margins.
// Their labels remain readable while the document itself is zoomed.
export function rulerAxis(length, start, end, scale = 1) {
  const step = scale < .8 ? 12 : 6; // quarter/eighth inch, in CSS document pixels
  const ticks = [];
  for (let n = Math.ceil(-start / step); n * step <= length - start; n++) {
    const value = n * step;
    const major = value % 96 === 0;
    ticks.push({ at: (start + value) * scale, major,
      label: major ? String(value / 96) : null });
  }
  return { length: length * scale, start: start * scale, end: (length - end) * scale, ticks };
}

const svgNode = (tag, attrs) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
function rulerSvg(axis, vertical = false) {
  const cross = 20;
  const svg = svgNode('svg', { width: vertical ? cross : axis.length, height: vertical ? axis.length : cross, 'aria-hidden': 'true' });
  const rect = (at, length) => svgNode('rect', vertical
    ? { x: 0, y: at, width: cross, height: length, class: 'ms-ruler-margin' }
    : { x: at, y: 0, width: length, height: cross, class: 'ms-ruler-margin' });
  svg.append(rect(0, axis.start), rect(axis.end, axis.length - axis.end));
  for (const tick of axis.ticks) {
    const line = svgNode('line', vertical
      ? { x1: tick.major ? 15 : 17, x2: 20, y1: tick.at, y2: tick.at }
      : { x1: tick.at, x2: tick.at, y1: tick.major ? 16 : 17, y2: 20 });
    svg.append(line);
    if (tick.label !== null && tick.at > 7 && tick.at < axis.length - 7) {
      const text = svgNode('text', vertical ? { x: 7, y: tick.at + 3, 'text-anchor': 'middle' }
        : { x: tick.at, y: 12, 'text-anchor': 'middle' });
      text.textContent = tick.label;
      svg.append(text);
    }
  }
  for (const at of [axis.start, axis.end]) svg.append(svgNode('line', vertical
    ? { x1: 0, x2: 20, y1: at, y2: at, class: 'ms-ruler-boundary' }
    : { x1: at, x2: at, y1: 0, y2: 20, class: 'ms-ruler-boundary' }));
  return svg;
}

export function updatePageRulers(el, { vertical = true } = {}) {
  const wrap = el.querySelector('#ms-scroll'), bar = el.querySelector('#ms-ruler-bar');
  const rails = el.querySelector('#ms-ruler-verticals');
  if (!wrap || !bar || !rails) return;
  const pages = [...el.querySelectorAll('#page .pg')];
  bar.hidden = !pages.length;
  rails.hidden = !pages.length;
  if (!pages.length) { rails.replaceChildren(); return; }
  const area = wrap.getBoundingClientRect();
  const active = pages.find(p => p.getBoundingClientRect().bottom > area.top + 40) || pages.at(-1);
  const box = active.getBoundingClientRect(), style = getComputedStyle(active);
  const scale = box.width / active.offsetWidth;
  const axis = rulerAxis(active.offsetWidth, parseFloat(style.paddingLeft), parseFloat(style.paddingRight), scale);
  const button = bar.querySelector('button');
  button.style.left = `${box.left - bar.getBoundingClientRect().left}px`;
  const key = [axis.length, axis.start, axis.end].join('|');
  if (button.dataset.geometry !== key) { button.replaceChildren(rulerSvg(axis)); button.dataset.geometry = key; }
  button.setAttribute('aria-label', `Page margins: left ${parseFloat(style.paddingLeft) / 96} inches, right ${parseFloat(style.paddingRight) / 96} inches. Open page setup`);
  if (!vertical) return;
  rails.replaceChildren(...pages.map(pg => {
    const r = pg.getBoundingClientRect(), s = getComputedStyle(pg);
    const rail = document.createElement('div');
    rail.className = 'ms-ruler-vertical';
    rail.style.left = `${r.left - area.left + wrap.scrollLeft - 24}px`;
    rail.style.top = `${r.top - area.top + wrap.scrollTop}px`;
    rail.append(rulerSvg(rulerAxis(pg.offsetHeight, parseFloat(s.paddingTop), parseFloat(s.paddingBottom), r.height / pg.offsetHeight), true));
    return rail;
  }));
}
