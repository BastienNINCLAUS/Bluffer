// Thèmes (tags) des questions : fonctions pures partagées par le moteur, le serveur et les tests.
export const FALLBACK_TAG = 'Divers';
// Thème des questions « classiques » (faits simples tirés de Wikidata) : décoché par défaut.
export const CLASSIC_TAG = 'Classique';

export function tagsOf(question) {
  const tags = Array.isArray(question?.tags) ? question.tags.filter((t) => typeof t === 'string' && t.trim() !== '') : [];
  return tags.length > 0 ? tags : [FALLBACK_TAG];
}

const byName = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

// Liste des thèmes avec le nombre de questions de chacun (une question compte une fois par thème).
export function themeCounts(questions) {
  const counts = new Map();
  for (const question of questions) {
    for (const tag of new Set(tagsOf(question))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => byName(a.name, b.name));
}

// Questions dont au moins un thème est sélectionné (null = tous les thèmes).
export function filterByThemes(questions, themes) {
  if (themes === null || themes === undefined) return [...questions];
  const wanted = new Set(themes);
  return questions.filter((q) => tagsOf(q).some((tag) => wanted.has(tag)));
}

// Sélection initiale d'un salon : tous les thèmes sauf « Classique » (null = tous, s'il n'y a rien à exclure).
export function defaultThemes(questions) {
  const names = themeCounts(questions).map((t) => t.name);
  const selected = names.filter((name) => name !== CLASSIC_TAG);
  return selected.length === names.length || selected.length === 0 ? null : selected;
}
