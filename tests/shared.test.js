import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, normalizeText, initials } from '../shared/text.js';
import { rankTeams, barPercents, interpolate } from '../shared/ranking.js';
import { tagsOf, themeCounts, filterByThemes } from '../shared/themes.js';

describe('texte', () => {
  test('cleanText', () => {
    assert.equal(cleanText('  a   b \n c '), 'a b c');
    assert.equal(cleanText(42), '');
    assert.equal(cleanText(undefined), '');
  });

  test('normalizeText ignore casse, accents et ponctuation', () => {
    assert.equal(normalizeText(' L’Éléphant! '), 'lelephant');
    assert.equal(normalizeText('???'), '');
  });

  test('initials', () => {
    assert.equal(initials('Alice Martin'), 'AM');
    assert.equal(initials('bob'), 'BO');
    assert.equal(initials('  '), '?');
  });
});

describe('classement', () => {
  const team = (id, score, prev = 0) => ({ id, score, prevScore: prev });

  test('tri décroissant, égalités dans l’ordre de création (stable)', () => {
    const ranking = rankTeams([team('a', 3), team('b', 5), team('c', 3), team('d', 0)]);
    assert.deepEqual(ranking.map((r) => r.id), ['b', 'a', 'c', 'd']);
    assert.deepEqual(ranking.map((r) => r.rank), [1, 2, 2, 4]);
  });

  test('égalité en tête : même rang', () => {
    const ranking = rankTeams([team('a', 2), team('b', 2), team('c', 1)]);
    assert.deepEqual(ranking.map((r) => r.rank), [1, 1, 3]);
  });

  test('tri sur un autre champ', () => {
    const ranking = rankTeams([team('a', 9, 1), team('b', 0, 4)], 'prevScore');
    assert.deepEqual(ranking.map((r) => r.id), ['b', 'a']);
  });

  test('l’entrée n’est pas modifiée', () => {
    const input = [team('a', 1), team('b', 2)];
    rankTeams(input);
    assert.deepEqual(input.map((t) => t.id), ['a', 'b']);
  });

  test('barres : relatives au meilleur score, nulles si tout le monde est à 0', () => {
    assert.deepEqual(barPercents([0, 0, 0]), [0, 0, 0]);
    assert.deepEqual(barPercents([10, 5, 0]), [100, 50, 0]);
    assert.deepEqual(barPercents([3, 1]), [100, 33.3]);
    assert.deepEqual(barPercents([]), []);
  });

  test('interpolation bornée', () => {
    assert.equal(interpolate(2, 6, 0), 2);
    assert.equal(interpolate(2, 6, 0.5), 4);
    assert.equal(interpolate(2, 6, 2), 6);
    assert.equal(interpolate(2, 6, -1), 2);
  });
});


describe('thèmes', () => {
  const Q = [
    { id: '1', text: 'a ?', answer: 'x', tags: ['B', 'A'] },
    { id: '2', text: 'b ?', answer: 'y', tags: ['A'] },
    { id: '3', text: 'c ?', answer: 'z' },
    { id: '4', text: 'd ?', answer: 'w', tags: ['Classique'] },
  ];

  test('tagsOf : thème « Divers » par défaut, tags vides ignorés', () => {
    assert.deepEqual(tagsOf({}), ['Divers']);
    assert.deepEqual(tagsOf({ tags: ['', 3, 'A'] }), ['A']);
    assert.deepEqual(tagsOf({ tags: [] }), ['Divers']);
  });

  test('themeCounts : tri alphabétique français, une question compte une fois par thème', () => {
    assert.deepEqual(themeCounts([...Q, { id: '5', text: 'e ?', answer: 'v', tags: ['É', 'É'] }]), [
      { name: 'A', count: 2 },
      { name: 'B', count: 1 },
      { name: 'Classique', count: 1 },
      { name: 'Divers', count: 1 },
      { name: 'É', count: 1 },
    ]);
  });

  test('filterByThemes : union des thèmes, null pour tout, liste vide pour rien', () => {
    assert.deepEqual(filterByThemes(Q, ['B', 'Divers']).map((q) => q.id), ['1', '3']);
    assert.equal(filterByThemes(Q, null).length, 4);
    assert.equal(filterByThemes(Q, []).length, 0);
  });
});