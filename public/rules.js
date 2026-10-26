import { h } from './lib/dom.js';
import { parseRules, inlineSegments } from '../shared/markdown.js';
import { loadJson, saveJson } from './lib/net.js';

const CACHE_KEY = 'bluffer.rules';
const FALLBACK = '# Règles de Bluffer\n\n## Le principe\n- Inventez une fausse réponse crédible, puis votez pour la vraie.\n- **+2 points** par vote reçu sur votre réponse, **+1 point** pour avoir trouvé la vraie.';

// Charge les règles ; en cas d'échec (WiFi coupé), reprend la dernière copie connue.
export async function fetchRules() {
  try {
    const response = await fetch('/api/rules');
    if (!response.ok) throw new Error('http');
    const text = await response.text();
    saveJson(CACHE_KEY, text);
    return text;
  } catch {
    return loadJson(CACHE_KEY) ?? FALLBACK;
  }
}

function inline(text) {
  return inlineSegments(text).map((segment) => (segment.bold ? h('strong', {}, segment.text) : segment.text));
}

export function renderSection(section) {
  return h(
    'div',
    { class: 'rules-section' },
    section.title ? h('h3', {}, section.title) : null,
    section.blocks.map((block) =>
      block.type === 'list'
        ? h('ul', {}, block.items.map((item) => h('li', {}, inline(item))))
        : h('p', {}, inline(block.text)),
    ),
  );
}

// Panneau de l'écran hôte : les règles défilent par étapes courtes, lisibles de loin.
export function createRulesCarousel(text, vars, intervalMs = 9000) {
  let index = 0;
  let parsed = parseRules(text, vars);
  const body = h('div', { class: 'rules-body' });
  const dots = h('div', { class: 'rules-dots' });
  const el = h('section', { class: 'card rules-card' }, h('h2', {}, parsed.title || 'Règles'), body, dots);

  const show = () => {
    const sections = parsed.sections;
    if (sections.length === 0) return;
    index %= sections.length;
    body.replaceChildren(renderSection(sections[index]));
    dots.replaceChildren(...sections.map((_, i) => h('span', { class: i === index ? 'dot active' : 'dot' })));
  };
  show();
  const timer = setInterval(() => {
    index += 1;
    show();
  }, intervalMs);

  return {
    el,
    update(nextVars) {
      parsed = parseRules(text, nextVars);
      show();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}

// Fenêtre plein écran du téléphone ; la fermer ne touche à rien d'autre dans la page.
export function openRulesModal(text, vars) {
  const parsed = parseRules(text, vars);
  const close = () => overlay.remove();
  const overlay = h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Règles du jeu' },
    h(
      'div',
      { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, parsed.title || 'Règles'), h('button', { class: 'btn small', onclick: close, type: 'button' }, 'Fermer')),
      h('div', { class: 'modal-body' }, parsed.sections.map(renderSection)),
    ),
  );
  document.body.append(overlay);
  return close;
}
