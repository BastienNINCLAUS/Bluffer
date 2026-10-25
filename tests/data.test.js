import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestions, loadQuestions } from '../game/questions.js';
import { parseRules, inlineSegments } from '../shared/markdown.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('banque de questions', () => {
  const questions = loadQuestions(join(root, 'game', 'questions.json'));

  test('au moins 20 questions valides', () => {
    assert.ok(questions.length >= 20, `${questions.length} questions`);
    assert.deepEqual(validateQuestions(questions), []);
  });

  test('chaque question se termine par un point d’interrogation et a une réponse courte', () => {
    for (const q of questions) {
      assert.match(q.text, /\?$/, q.id);
      assert.ok(q.answer.length <= 80, q.id);
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
    ]);
    assert.ok(problems.some((p) => p.includes('en double') && p.includes('identifiant')));
    assert.ok(problems.some((p) => p.includes('énoncé en double')));
    assert.ok(problems.some((p) => p.includes('« answer »')));
    assert.ok(problems.some((p) => p.includes('trop longue')));
    assert.ok(problems.some((p) => p.includes('objet attendu')));
    assert.ok(problems.some((p) => p.includes('« text »')));
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
