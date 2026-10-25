// Analyse d'un sous-ensemble de Markdown : titre `#`, sections `##`, listes `-` et paragraphes.
// Le rendu se fait côté client avec textContent (pas de HTML injecté).
export function parseRules(markdown, variables = {}) {
  const text = String(markdown ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
  );
  let title = '';
  const sections = [];
  let current = null;

  const ensureSection = () => {
    if (!current) {
      current = { title: '', blocks: [] };
      sections.push(current);
    }
    return current;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), blocks: [] };
      sections.push(current);
    } else if (line.startsWith('# ')) {
      title = line.slice(2).trim();
    } else if (line.startsWith('- ')) {
      const section = ensureSection();
      const last = section.blocks.at(-1);
      if (last && last.type === 'list') last.items.push(line.slice(2).trim());
      else section.blocks.push({ type: 'list', items: [line.slice(2).trim()] });
    } else {
      ensureSection().blocks.push({ type: 'paragraph', text: line });
    }
  }
  return { title, sections };
}

// Découpe « a **b** c » en segments { text, bold }.
export function inlineSegments(text) {
  return String(text)
    .split('**')
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}
