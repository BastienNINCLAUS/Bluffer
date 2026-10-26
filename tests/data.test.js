import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestions, loadQuestions, loadQuestionBank } from '../game/questions.js';
import { parseRules, inlineSegments } from '../shared/markdown.js';
import { themeCounts, filterByThemes } from '../shared/themes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('banque de questions', () => {
  const questions = loadQuestionBank(join(root, 'game'));

  test('le fichier principal et la banque complète sont valides', () => {
    assert.ok(loadQuestions(join(root, 'game', 'questions.json')).length >= 50);
    assert.ok(questions.length >= 1000, `${questions.length} questions`);
    assert.deepEqual(validateQuestions(questions), []);
  });

  test('chaque question a au moins un thème', () => {
    for (const q of questions) {
      assert.ok(Array.isArray(q.tags) && q.tags.length > 0, q.id);
    }
  });

  test('les thèmes saisonniers et « Automobile » ont de quoi remplir une partie de 10 questions', () => {
    const counts = new Map(themeCounts(questions).map((t) => [t.name, t.count]));
    for (const theme of ['Halloween', 'Noël', 'Pâques', 'Automobile', 'Insolite', 'Histoire', 'Animaux']) {
      assert.ok((counts.get(theme) ?? 0) >= 10, `${theme} : ${counts.get(theme) ?? 0}`);
    }
  });

  test('hors « Classique », la sélection par défaut suffit largement pour une partie', () => {
    const others = filterByThemes(questions, themeCounts(questions).map((t) => t.name).filter((n) => n !== 'Classique'));
    assert.ok(others.length >= 1000);
  });

  test('chaque question se termine par un point d’interrogation et a une réponse courte', () => {
    for (const q of questions) {
      assert.match(q.text, /\?$/, q.id);
      assert.ok(q.answer.length <= 80, q.id);
    }
  });

  test('les questions à trous ont un seul trou et ne contiennent pas leur réponse', () => {
    const gaps = questions.filter((q) => q.id.startsWith('lsv-'));
    assert.ok(gaps.length >= 900);
    for (const q of gaps) {
      assert.equal(q.text.split('____').length, 2, q.id);
      assert.ok(!/[[\]{}|]|'''/.test(q.text), `${q.id} : markup résiduel`);
    }
  });

  test('le validateur détecte les problèmes', () => {
    assert.deepEqual(validateQuestions('x'), ['La banque doit être un tableau.']);
    const problems = validateQuestions([
      { id: 'a', text: 'Q ?', answer: 'R' },
      { id: 'a', text: 'q ?', answer: '' },
      { id: 'b', text: 'Autre ?', answer: 'x'.repeat(81) },
      null,
      { id: 'c' },
      { id: 'd', text: 'D ?', answer: 'd', tags: [] },
      { id: 'e', text: 'E ?', answer: 'e', tags: ['ok', ''] },
    ]);
    assert.ok(problems.some((p) => p.includes('en double') && p.includes('identifiant')));
    assert.ok(problems.some((p) => p.includes('énoncé en double')));
    assert.ok(problems.some((p) => p.includes('« answer »')));
    assert.ok(problems.some((p) => p.includes('trop longue')));
    assert.ok(problems.some((p) => p.includes('objet attendu')));
    assert.ok(problems.some((p) => p.includes('« text »')));
    assert.equal(problems.filter((p) => p.includes('« tags »')).length, 2);
  });
});

describe('règles du jeu dans l’application', () => {
  const path = join(root, 'game', 'rules.md');

  test('game/rules.md existe et se découpe en sections', () => {
    assert.ok(existsSync(path));
    const rules = parseRules(readFileSync(path, 'utf8'), { delai: 30 });
    assert.ok(rules.title.length > 0);
    assert.ok(rules.sections.length >= 5);
    for (const section of rules.sections) {
      assert.ok(section.title.length > 0);
      assert.ok(section.blocks.length > 0);
    }
  });

  test('les points, le vote sur sa propre réponse et le délai sont expliqués', () => {
    const text = readFileSync(path, 'utf8');
    assert.match(text, /\+2 points/);
    assert.match(text, /\+1 point/);
    assert.match(text, /propre réponse/);
    assert.match(text, /\{\{delai\}\}/);
    assert.match(text, /tchat/i);
    assert.match(text, /Valider/);
  });

  test('la valeur du délai est injectée', () => {
    const rules = parseRules(readFileSync(path, 'utf8'), { delai: 45 });
    const flat = JSON.stringify(rules);
    assert.match(flat, /45 secondes/);
    assert.ok(!flat.includes('{{delai}}'));
  });
});

describe('analyse Markdown', () => {
  test('titres, listes et paragraphes', () => {
    const rules = parseRules('# T\n\n## S1\n- a\n- b\ntexte\n\n## S2\n- c');
    assert.equal(rules.title, 'T');
    assert.deepEqual(rules.sections[0].blocks, [
      { type: 'list', items: ['a', 'b'] },
      { type: 'paragraph', text: 'texte' },
    ]);
    assert.equal(rules.sections[1].title, 'S2');
  });

  test('variable inconnue conservée, contenu avant toute section', () => {
    const rules = parseRules('intro {{x}}', {});
    assert.equal(rules.sections[0].title, '');
    assert.equal(rules.sections[0].blocks[0].text, 'intro {{x}}');
    assert.deepEqual(parseRules(undefined), { title: '', sections: [] });
  });

  test('segments en gras, sans HTML interprété', () => {
    assert.deepEqual(inlineSegments('a **b** <i>c</i>'), [
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' <i>c</i>', bold: false },
    ]);
  });
});
