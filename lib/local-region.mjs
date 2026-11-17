/** Replace only named regions from trusted application markup; retain all siblings. */
export function replaceRegions(root, html, selectors) {
  const template = document.createElement('template'); template.innerHTML = html;
  for (const selector of selectors) {
    const old = root.querySelector(selector), next = template.content.querySelector(selector);
    if (old && next) {
      const top = old.scrollTop, left = old.scrollLeft;
      old.replaceWith(next); next.scrollTop = top; next.scrollLeft = left;
    } else if (old) old.remove();
  }
}
