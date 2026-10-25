// Classement stable : à égalité de points, l'ordre de création des équipes est conservé.
// Le rang suit la règle sportive (1, 1, 3).
export function rankTeams(teams, scoreKey = 'score') {
  const sorted = teams
    .map((team, index) => ({ team, index }))
    .sort((a, b) => b.team[scoreKey] - a.team[scoreKey] || a.index - b.index);
  let rank = 0;
  return sorted.map(({ team }, position) => {
    if (position === 0 || team[scoreKey] !== sorted[position - 1].team[scoreKey]) rank = position + 1;
    return { id: team.id, rank, score: team[scoreKey] };
  });
}

// Largeur des barres en pourcentage, relative au meilleur score (0 si tout le monde est à 0).
export function barPercents(scores) {
  const max = Math.max(0, ...scores);
  return scores.map((score) => (max === 0 ? 0 : Math.round((score / max) * 1000) / 10));
}

// Valeur intermédiaire d'une animation, progress dans [0, 1].
export function interpolate(from, to, progress) {
  const p = Math.min(1, Math.max(0, progress));
  return from + (to - from) * p;
}
