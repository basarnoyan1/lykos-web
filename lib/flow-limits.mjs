export const FLOW_LIMITS = Object.freeze({ blocks: 1000, edges: 8000, importBytes: 10_000_000, historyBytes: 8_000_000 });

export function canvasWindow(blocks, {left, top, width, height, zoom, selected}) {
  const pad = 240, x = left / zoom, y = top / zoom;
  return blocks.filter(b => b.id === selected || (b.x + 260 >= x - pad && b.x <= x + width / zoom + pad && b.y + 100 >= y - pad && b.y <= y + height / zoom + pad));
}
