// On a Mac, shortcuts are written with Cmd and Option. Every label and tooltip
// in the app says Ctrl and Alt, so on a Mac they are rewritten as they appear.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const swap = (s) => s.replace(/\bCtrl\b/g, 'Cmd').replace(/\bAlt\b/g, 'Option');
const needs = (s) => typeof s === 'string' && /\b(Ctrl|Alt)\b/.test(s);

function fix(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (needs(node.nodeValue)) node.nodeValue = swap(node.nodeValue);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  for (const a of ['title', 'placeholder']) if (needs(node.getAttribute(a))) node.setAttribute(a, swap(node.getAttribute(a)));
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (needs(n.nodeValue)) n.nodeValue = swap(n.nodeValue);
    } else for (const a of ['title', 'placeholder']) if (needs(n.getAttribute(a))) n.setAttribute(a, swap(n.getAttribute(a)));
  }
}

export function initMacLabels() {
  if (!isMac) return;
  document.body.classList.add('mac');
  fix(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(fix);
      else if (m.type === 'characterData') fix(m.target);
      else if (m.type === 'attributes') fix(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}
