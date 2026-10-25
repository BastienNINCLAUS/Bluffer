import { readFileSync } from 'node:fs';

// Renvoie la liste des problèmes détectés dans une banque de questions.
export function validateQuestions(list) {
  const problems = [];
  if (!Array.isArray(list)) return ['La banque doit être un tableau.'];
  const ids = new Set();
  const texts = new Set();
  list.forEach((q, i) => {
    const label = `question #${i + 1}`;
    if (typeof q !== 'object' || q === null) {
      problems.push(`${label} : objet attendu`);
      return;
    }
    for (const field of ['id', 'text', 'answer']) {
      if (typeof q[field] !== 'string' || q[field].trim() === '') {
        problems.push(`${label} : champ « ${field} » manquant ou vide`);
      }
    }
    if (typeof q.id === 'string') {
      if (ids.has(q.id)) problems.push(`${label} : identifiant « ${q.id} » en double`);
      ids.add(q.id);
    }
    if (typeof q.text === 'string') {
      const key = q.text.trim().toLowerCase();
      if (texts.has(key)) problems.push(`${label} : énoncé en double`);
      texts.add(key);
    }
    if (typeof q.answer === 'string' && q.answer.length > 80) {
      problems.push(`${label} : réponse trop longue (80 caractères max)`);
    }
  });
  return problems;
}

export function loadQuestions(path) {
  const list = JSON.parse(readFileSync(path, 'utf8'));
  const problems = validateQuestions(list);
  if (problems.length > 0) throw new Error(`Banque de questions invalide :\n- ${problems.join('\n- ')}`);
  return list;
}
