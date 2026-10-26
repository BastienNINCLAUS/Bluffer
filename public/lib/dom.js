// Construction DOM par nœuds texte uniquement : aucune injection de HTML n'est possible.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'vars') {
      for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else if (key in el && typeof value !== 'object' && key !== 'list') el[key] = value;
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

// Reconstruit le contenu d'une zone seulement si sa clé change (évite de casser focus et animations).
export function region(el, key, build) {
  if (el.dataset.key === key) return false;
  el.dataset.key = key;
  el.replaceChildren();
  append(el, [build()]);
  return true;
}

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
