import { Game } from '../game/engine.js';

export function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

// Générateur pseudo-aléatoire déterministe (mulberry32).
export function seededRng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const QUESTIONS = [
  { id: 'q1', text: 'Question 1 ?', answer: 'Réponse vraie 1' },
  { id: 'q2', text: 'Question 2 ?', answer: 'Réponse vraie 2' },
  { id: 'q3', text: 'Question 3 ?', answer: 'Réponse vraie 3' },
  { id: 'q4', text: 'Question 4 ?', answer: 'Réponse vraie 4' },
  { id: 'q5', text: 'Question 5 ?', answer: 'Réponse vraie 5' },
  { id: 'q6', text: 'Question 6 ?', answer: 'Réponse vraie 6' },
];

export function newGame(config = {}, extra = {}) {
  const clock = extra.clock ?? makeClock();
  const game = new Game({
    code: 'ABCD',
    questions: extra.questions ?? QUESTIONS,
    config,
    now: clock.now,
    rng: seededRng(extra.seed ?? 7),
  });
  game.clock = clock;
  return game;
}

export function expectOk(result) {
  if (!result.ok) throw new Error(`Résultat inattendu : ${JSON.stringify(result)}`);
  return result;
}

export function addPlayers(game, names) {
  return names.map((name) => expectOk(game.addPlayer(name)).player.id);
}

// Partie en mode « base » (une équipe par joueur) démarrée sur la première question.
export function startedBaseGame(names = ['Ann', 'Bob', 'Cid'], config = {}, extra = {}) {
  const game = newGame({ mode: 'base', totalQuestions: 3, ...config }, extra);
  const ids = addPlayers(game, names);
  expectOk(game.start());
  return { game, ids, teamIds: ids.map((id) => game.players.get(id).teamId) };
}

// Partie en mode « équipes » : sizes = taille de chaque équipe, noms « Equipe 1 », « Equipe 2 »…
export function startedTeamsGame(sizes = [1, 2, 2], config = {}, extra = {}) {
  const game = newGame({ mode: 'teams', totalQuestions: 3, ...config }, extra);
  const groups = sizes.map((size, i) => addPlayers(game, Array.from({ length: size }, (_, j) => `J${i + 1}-${j + 1}`)));
  groups.forEach((ids) => {
    expectOk(game.createTeam(ids[0]));
    const teamId = game.players.get(ids[0]).teamId;
    ids.slice(1).forEach((id) => expectOk(game.joinTeam(id, teamId)));
  });
  expectOk(game.lockTeams());
  groups.forEach((ids, i) => {
    if (ids.length > 1) nameTeam(game, ids, `Equipe ${i + 1}`);
  });
  expectOk(game.start());
  return { game, groups, teamIds: groups.map((ids) => game.players.get(ids[0]).teamId) };
}

export function nameTeam(game, ids, name) {
  expectOk(game.propose(ids[0], name));
  ids.forEach((id) => expectOk(game.validate(id)));
}

export function everyoneReady(game) {
  for (const player of game.players.values()) game.setReady(player.id, true);
}

// Passe de « question » à « writing ».
export function toWriting(game) {
  everyoneReady(game);
  return game;
}

// Chaque entrée de answers = [groupe de joueurs, texte] : propose puis valide pour tous.
export function submitAnswers(game, entries) {
  for (const [ids, text] of entries) {
    expectOk(game.propose(ids[0], text));
    ids.forEach((id) => game.validate(id));
  }
}

export function submitVotes(game, entries) {
  for (const [ids, optionId] of entries) {
    expectOk(game.propose(ids[0], optionId));
    ids.forEach((id) => game.validate(id));
  }
}

export function optionOf(game, predicate) {
  return game.options.find(predicate);
}
