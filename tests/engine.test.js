import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASES, TEAM_COLORS, LIMITS } from '../game/engine.js';
import {
  newGame, addPlayers, expectOk, startedBaseGame, startedTeamsGame, nameTeam, everyoneReady,
  toWriting, submitAnswers, submitVotes, optionOf, QUESTIONS,
} from './helpers.js';

const errorOf = (result) => {
  assert.equal(result.ok, false, `une erreur était attendue, reçu ${JSON.stringify(result)}`);
  return result.error;
};

describe('salon et configuration', () => {
  test('refuse une banque vide', () => {
    assert.throws(() => new Game({ questions: [] }));
  });

  test('valeurs par défaut', () => {
    const game = newGame();
    assert.deepEqual(game.config, { mode: 'teams', totalQuestions: 6, graceSeconds: 30, advance: 'both', themes: null });
  });

  test('le nombre de questions par défaut ne dépasse pas la banque', () => {
    assert.equal(newGame().config.totalQuestions, QUESTIONS.length);
  });

  test('validation des réglages', () => {
    const game = newGame();
    assert.equal(errorOf(game.configure({ mode: 'autre' })), 'invalid_config');
    assert.equal(errorOf(game.configure({ totalQuestions: 0 })), 'invalid_config');
    assert.equal(errorOf(game.configure({ totalQuestions: QUESTIONS.length + 1 })), 'invalid_config');
    assert.equal(errorOf(game.configure({ graceSeconds: 1 })), 'invalid_config');
    assert.equal(errorOf(game.configure({ graceSeconds: 1000 })), 'invalid_config');
    assert.equal(errorOf(game.configure({ advance: 'x' })), 'invalid_config');
    expectOk(game.configure({ totalQuestions: 4, graceSeconds: 45, advance: 'phones' }));
    assert.deepEqual(game.config, { mode: 'teams', totalQuestions: 4, graceSeconds: 45, advance: 'phones', themes: null });
  });

  test('les réglages ne changent plus après le lancement', () => {
    const { game } = startedBaseGame();
    assert.equal(errorOf(game.configure({ graceSeconds: 10 })), 'wrong_phase');
  });

  test('validation du pseudo : vide, trop long, doublon insensible à la casse et aux accents', () => {
    const game = newGame();
    assert.equal(errorOf(game.addPlayer('   ')), 'invalid_name');
    assert.equal(errorOf(game.addPlayer('x'.repeat(LIMITS.playerNameMax + 1))), 'invalid_name');
    assert.equal(errorOf(game.addPlayer('!!!')), 'invalid_name');
    expectOk(game.addPlayer('Élodie'));
    assert.equal(errorOf(game.addPlayer(' elodie ')), 'name_taken');
  });

  test('limite de joueurs', () => {
    const game = newGame();
    for (let i = 0; i < LIMITS.maxPlayers; i += 1) expectOk(game.addPlayer(`joueur${i}`));
    assert.equal(errorOf(game.addPlayer('de trop')), 'game_full');
  });

  test('en mode base, chaque joueur a sa propre équipe nommée comme lui', () => {
    const game = newGame({ mode: 'base' });
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    const teamA = game.teamOf(a);
    assert.equal(teamA.name, 'Ann');
    assert.notEqual(teamA.id, game.teamOf(b).id);
    assert.notEqual(teamA.color, game.teamOf(b).color);
  });

  test('changer de mode reconstruit ou dissout les équipes', () => {
    const game = newGame({ mode: 'base' });
    addPlayers(game, ['Ann', 'Bob', 'Cid']);
    assert.equal(game.teams.size, 3);
    expectOk(game.configure({ mode: 'teams' }));
    assert.equal(game.teams.size, 0);
    assert.ok([...game.players.values()].every((p) => p.teamId === null));
    expectOk(game.configure({ mode: 'base' }));
    assert.equal(game.teams.size, 3);
  });

  test('on ne rejoint pas une partie commencée', () => {
    const { game } = startedBaseGame();
    assert.equal(errorOf(game.addPlayer('Retardataire')), 'game_started');
  });

  test('photo : seul le JPEG en data URL est accepté', () => {
    const game = newGame();
    const [a] = addPlayers(game, ['Ann']);
    assert.equal(errorOf(game.setPhoto(a, 'data:image/png;base64,AAAA')), 'invalid_photo');
    assert.equal(errorOf(game.setPhoto(a, '<script>')), 'invalid_photo');
    assert.equal(errorOf(game.setPhoto(a, `data:image/jpeg;base64,${'A'.repeat(LIMITS.photoMaxChars)}`)), 'invalid_photo');
    expectOk(game.setPhoto(a, 'data:image/jpeg;base64,/9j/4AAQ'));
    assert.equal(game.players.get(a).photoVersion, 1);
    expectOk(game.setPhoto(a, null));
    assert.equal(game.players.get(a).photo, null);
  });

  test('retirer un joueur supprime son équipe vide', () => {
    const game = newGame();
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    expectOk(game.createTeam(a));
    expectOk(game.joinTeam(b, game.players.get(a).teamId));
    expectOk(game.removePlayer(b));
    assert.equal(game.teams.size, 1);
    expectOk(game.removePlayer(a));
    assert.equal(game.teams.size, 0);
  });
});

describe('constitution des équipes', () => {
  test('créer, rejoindre et quitter une équipe supprime les équipes vides', () => {
    const game = newGame();
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    expectOk(game.createTeam(a));
    const teamA = game.players.get(a).teamId;
    expectOk(game.createTeam(b));
    expectOk(game.joinTeam(b, teamA));
    assert.equal(game.teams.size, 1);
    assert.equal(game.members(game.teams.get(teamA)).length, 2);
  });

  test('créer une équipe quand on est déjà seul dans la sienne ne change rien', () => {
    const game = newGame();
    const [a] = addPlayers(game, ['Ann']);
    const first = expectOk(game.createTeam(a)).team.id;
    assert.equal(expectOk(game.createTeam(a)).team.id, first);
    assert.equal(game.teams.size, 1);
  });

  test('couleurs : attribution automatique distincte, changement parmi les libres', () => {
    const game = newGame();
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    game.createTeam(a);
    game.createTeam(b);
    const colorA = game.teamOf(a).color;
    const colorB = game.teamOf(b).color;
    assert.notEqual(colorA, colorB);
    assert.equal(errorOf(game.setTeamColor(a, colorB)), 'color_taken');
    assert.equal(errorOf(game.setTeamColor(a, '#123456')), 'invalid_color');
    const free = TEAM_COLORS.find((c) => c !== colorA && c !== colorB);
    expectOk(game.setTeamColor(a, free));
    assert.equal(game.teamOf(a).color, free);
  });

  test('deux équipes qui choisissent la même couleur : la première gagne', () => {
    const game = newGame();
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    game.createTeam(a);
    game.createTeam(b);
    const target = TEAM_COLORS[9];
    expectOk(game.setTeamColor(a, target));
    assert.equal(errorOf(game.setTeamColor(b, target)), 'color_taken');
  });

  test('palette suffisante pour le maximum d’équipes', () => {
    assert.ok(new Set(TEAM_COLORS).size >= LIMITS.maxTeams);
    const game = newGame();
    const ids = addPlayers(game, Array.from({ length: LIMITS.maxTeams + 1 }, (_, i) => `j${i}`));
    ids.slice(0, LIMITS.maxTeams).forEach((id) => expectOk(game.createTeam(id)));
    assert.equal(errorOf(game.createTeam(ids[LIMITS.maxTeams])), 'too_many_teams');
    assert.equal(new Set(game.teamList().map((t) => t.color)).size, LIMITS.maxTeams);
  });

  test('tirage au sort : tout le monde est placé, équipes équilibrées', () => {
    const game = newGame();
    addPlayers(game, Array.from({ length: 10 }, (_, i) => `j${i}`));
    expectOk(game.randomize());
    assert.equal(game.teams.size, 3);
    const sizes = game.teamList().map((t) => game.members(t).length).sort();
    assert.deepEqual(sizes, [3, 3, 4]);
    assert.ok([...game.players.values()].every((p) => p.teamId));
  });

  test('tirage au sort : nombre d’équipes demandé et bornes', () => {
    const game = newGame();
    addPlayers(game, Array.from({ length: 9 }, (_, i) => `j${i}`));
    expectOk(game.randomize(4));
    assert.equal(game.teams.size, 4);
    expectOk(game.randomize(1));
    assert.equal(game.teams.size, LIMITS.minTeams);
  });

  test('tirage au sort impossible avec moins de 3 joueurs', () => {
    const game = newGame();
    addPlayers(game, ['Ann', 'Bob']);
    assert.equal(errorOf(game.randomize()), 'not_enough_players');
  });

  test('verrouillage : refuse des joueurs sans équipe et moins de 3 équipes', () => {
    const game = newGame();
    const [a, b, c, d] = addPlayers(game, ['Ann', 'Bob', 'Cid', 'Dan']);
    game.createTeam(a);
    game.createTeam(b);
    game.createTeam(c);
    const result = game.lockTeams();
    assert.equal(errorOf(result), 'players_without_team');
    assert.equal(result.count, 1);
    game.joinTeam(d, game.players.get(c).teamId);
    expectOk(game.lockTeams());
    assert.equal(game.phase, PHASES.NAMING);
  });

  test('verrouillage : moins de 3 équipes refusé', () => {
    const game = newGame();
    const [a, b] = addPlayers(game, ['Ann', 'Bob']);
    game.createTeam(a);
    game.createTeam(b);
    assert.equal(errorOf(game.lockTeams()), 'not_enough_teams');
  });

  test('verrouillage : un joueur déconnecté sans équipe est retiré', () => {
    const game = newGame();
    const [a, b, c, ghost] = addPlayers(game, ['Ann', 'Bob', 'Cid', 'Fantôme']);
    [a, b, c].forEach((id) => game.createTeam(id));
    game.setConnected(ghost, false);
    expectOk(game.lockTeams());
    assert.equal(game.players.has(ghost), false);
  });

  test('déverrouillage : retour au salon, noms effacés', () => {
    const { game } = (() => {
      const g = newGame();
      const ids = addPlayers(g, ['Ann', 'Bob', 'Cid']);
      ids.forEach((id) => g.createTeam(id));
      expectOk(g.lockTeams());
      return { game: g };
    })();
    assert.ok(game.teamList().every((t) => t.name !== null));
    expectOk(game.unlockTeams());
    assert.equal(game.phase, PHASES.LOBBY);
    assert.ok(game.teamList().every((t) => t.name === null));
  });
});

describe('nom d’équipe (vote avant la première question)', () => {
  function namingGame() {
    const game = newGame();
    const [a1, a2, b1, b2, c] = addPlayers(game, ['A1', 'A2', 'B1', 'B2', 'C']);
    game.createTeam(a1);
    game.joinTeam(a2, game.players.get(a1).teamId);
    game.createTeam(b1);
    game.joinTeam(b2, game.players.get(b1).teamId);
    game.createTeam(c);
    expectOk(game.lockTeams());
    return { game, A: [a1, a2], B: [b1, b2], C: c };
  }

  test('une équipe solo reçoit son pseudo comme nom, les autres attendent un vote', () => {
    const { game, A, C } = namingGame();
    assert.equal(game.teamOf(C).name, 'C');
    assert.equal(game.teamOf(A[0]).name, null);
    assert.equal(game.teamsReady(), 1);
  });

  test('le nom est adopté seulement à l’unanimité', () => {
    const { game, A } = namingGame();
    expectOk(game.propose(A[0], 'Les Lions'));
    assert.equal(game.teamOf(A[0]).name, null);
    expectOk(game.validate(A[0]));
    assert.equal(game.teamOf(A[0]).name, null);
    expectOk(game.validate(A[1]));
    assert.equal(game.teamOf(A[0]).name, 'Les Lions');
  });

  test('une nouvelle proposition remet les validations à zéro', () => {
    const { game, A } = namingGame();
    game.propose(A[0], 'Les Lions');
    game.validate(A[0]);
    game.propose(A[1], 'Les Tigres');
    assert.equal(game.teamOf(A[0]).validations.size, 0);
    game.validate(A[1]);
    assert.equal(game.teamOf(A[0]).name, null);
    game.validate(A[0]);
    assert.equal(game.teamOf(A[0]).name, 'Les Tigres');
  });

  test('on peut retirer sa validation tant que le nom n’est pas adopté', () => {
    const { game, A } = namingGame();
    game.propose(A[0], 'Les Lions');
    game.validate(A[0]);
    expectOk(game.unvalidate(A[0]));
    game.validate(A[1]);
    assert.equal(game.teamOf(A[0]).name, null);
    game.validate(A[0]);
    assert.equal(game.teamOf(A[0]).name, 'Les Lions');
    assert.equal(errorOf(game.unvalidate(A[0])), 'already_locked');
  });

  test('un nom adopté ne peut plus être changé', () => {
    const { game, A } = namingGame();
    nameTeam(game, A, 'Les Lions');
    assert.equal(errorOf(game.propose(A[0], 'Autre')), 'already_locked');
    assert.equal(errorOf(game.validate(A[0])), 'already_locked');
  });

  test('un nom déjà pris est refusé (insensible à la casse et aux accents)', () => {
    const { game, A, B } = namingGame();
    nameTeam(game, A, 'Les Lions');
    assert.equal(errorOf(game.propose(B[0], 'les lions')), 'name_taken');
    assert.equal(errorOf(game.propose(B[0], 'c')), 'name_taken');
  });

  test('deux équipes valident le même nom en même temps : la seconde est refusée à l’adoption', () => {
    const { game, A, B } = namingGame();
    game.propose(A[0], 'Les Lions');
    game.propose(B[0], 'Les Lions');
    game.validate(A[0]);
    game.validate(A[1]);
    assert.equal(game.teamOf(A[0]).name, 'Les Lions');
    game.validate(B[0]);
    game.validate(B[1]);
    const teamB = game.teamOf(B[0]);
    assert.equal(teamB.name, null);
    assert.equal(teamB.notice, 'name_taken');
    assert.equal(teamB.proposal, null);
  });

  test('une équipe solo peut renommer sans vote', () => {
    const { game, C } = namingGame();
    expectOk(game.propose(C, 'Solitaire'));
    assert.equal(game.teamOf(C).name, 'Solitaire');
  });

  test('texte de nom invalide', () => {
    const { game, A } = namingGame();
    assert.equal(errorOf(game.propose(A[0], '  ')), 'invalid_text');
    assert.equal(errorOf(game.propose(A[0], 'x'.repeat(LIMITS.teamNameMax + 1))), 'invalid_text');
  });

  test('on ne démarre que lorsque toutes les équipes ont un nom', () => {
    const { game, A, B } = namingGame();
    assert.equal(errorOf(game.start()), 'teams_not_ready');
    nameTeam(game, A, 'Les Lions');
    assert.equal(errorOf(game.start()), 'teams_not_ready');
    nameTeam(game, B, 'Les Ours');
    expectOk(game.start());
    assert.equal(game.phase, PHASES.QUESTION);
  });

  test('couleur modifiable pendant la phase de nom', () => {
    const { game, C } = namingGame();
    const free = TEAM_COLORS.find((c) => !game.teamList().some((t) => t.color === c));
    expectOk(game.setTeamColor(C, free));
  });
});

describe('démarrage', () => {
  test('mode base : au moins 3 joueurs', () => {
    const game = newGame({ mode: 'base' });
    addPlayers(game, ['Ann', 'Bob']);
    assert.equal(errorOf(game.start()), 'not_enough_teams');
    addPlayers(game, ['Cid']);
    expectOk(game.start());
    assert.equal(game.phase, PHASES.QUESTION);
  });

  test('mode équipes : on ne démarre pas depuis le salon', () => {
    const game = newGame();
    addPlayers(game, ['Ann', 'Bob', 'Cid']);
    assert.equal(errorOf(game.start()), 'wrong_phase');
  });

  test('mode base : un joueur déconnecté est retiré au démarrage', () => {
    const game = newGame({ mode: 'base' });
    const [, , , ghost] = addPlayers(game, ['Ann', 'Bob', 'Cid', 'Dan']);
    game.setConnected(ghost, false);
    expectOk(game.start());
    assert.equal(game.teams.size, 3);
  });

  test('le nombre de questions tirées respecte le réglage et sans doublon', () => {
    const { game } = startedBaseGame(['Ann', 'Bob', 'Cid'], { totalQuestions: 5 });
    assert.equal(game.order.length, 5);
    assert.equal(new Set(game.order.map((q) => q.id)).size, 5);
  });
});

describe('« Prêt » et avancement', () => {
  test('mode « both » : tous les joueurs prêts font avancer', () => {
    const { game, ids } = startedBaseGame();
    expectOk(game.setReady(ids[0]));
    expectOk(game.setReady(ids[1]));
    assert.equal(game.phase, PHASES.QUESTION);
    assert.deepEqual(game.readyCount(), { count: 2, total: 3 });
    expectOk(game.setReady(ids[2]));
    assert.equal(game.phase, PHASES.WRITING);
    assert.equal(game.ready.size, 0);
  });

  test('on peut retirer son « Prêt »', () => {
    const { game, ids } = startedBaseGame();
    game.setReady(ids[0]);
    game.setReady(ids[0], false);
    assert.equal(game.readyCount().count, 0);
  });

  test('les joueurs déconnectés ne bloquent pas', () => {
    const { game, ids } = startedBaseGame();
    game.setReady(ids[0]);
    game.setReady(ids[1]);
    game.setConnected(ids[2], false);
    assert.equal(game.phase, PHASES.WRITING);
  });

  test('l’écran peut faire avancer en mode « both » et « host »', () => {
    for (const advance of ['both', 'host']) {
      const { game } = startedBaseGame(undefined, { advance });
      expectOk(game.hostAdvance());
      assert.equal(game.phase, PHASES.WRITING);
    }
  });

  test('mode « phones » : l’écran ne peut pas forcer le « Prêt »', () => {
    const { game, ids } = startedBaseGame(undefined, { advance: 'phones' });
    assert.equal(errorOf(game.hostAdvance()), 'host_disabled');
    ids.forEach((id) => game.setReady(id));
    assert.equal(game.phase, PHASES.WRITING);
  });

  test('mode « host » : les téléphones ne font pas avancer', () => {
    const { game, ids } = startedBaseGame(undefined, { advance: 'host' });
    assert.equal(errorOf(game.setReady(ids[0])), 'ready_disabled');
  });

  test('« Prêt » refusé hors des phases d’attente', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    assert.equal(errorOf(game.setReady(ids[0])), 'wrong_phase');
  });

  test('en écriture, l’écran peut forcer le passage au vote même en mode « phones »', () => {
    const { game } = startedBaseGame(undefined, { advance: 'phones' });
    everyoneReady(game);
    expectOk(game.hostAdvance());
    assert.equal(game.phase, PHASES.VOTING);
  });
});

describe('écriture des fausses réponses', () => {
  test('une équipe solo valide directement', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    expectOk(game.propose(ids[0], 'Un chien'));
    assert.equal(game.teamOf(ids[0]).answer, 'Un chien');
    assert.equal(game.teamOf(ids[0]).locked, true);
  });

  test('refuse la vraie réponse (insensible à la casse, aux accents et à la ponctuation)', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    const truth = game.question.answer;
    assert.equal(errorOf(game.propose(ids[0], truth.toUpperCase() + ' !')), 'is_truth');
    assert.equal(game.teamOf(ids[0]).locked, false);
  });

  test('refuse un texte vide ou trop long', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    assert.equal(errorOf(game.propose(ids[0], '')), 'invalid_text');
    assert.equal(errorOf(game.propose(ids[0], '?!')), 'invalid_text');
    assert.equal(errorOf(game.propose(ids[0], 'x'.repeat(LIMITS.answerMax + 1))), 'invalid_text');
  });

  test('une réponse verrouillée ne peut plus changer', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    game.propose(ids[0], 'Un chien');
    assert.equal(errorOf(game.propose(ids[0], 'Un lion')), 'already_locked');
  });

  test('équipe de 2 : unanimité requise, remise à zéro sur nouvelle proposition', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    toWriting(game);
    const [p, q] = groups[1];
    game.propose(p, 'Un chien');
    game.validate(p);
    game.propose(q, 'Un lion');
    assert.equal(game.teamOf(p).validations.size, 0);
    game.validate(q);
    assert.equal(game.teamOf(p).answer, null);
    game.unvalidate(q);
    assert.equal(game.teamOf(p).validations.size, 0);
    game.validate(q);
    assert.equal(game.teamOf(p).answer, null);
    game.validate(p);
    assert.equal(game.teamOf(p).answer, 'Un lion');
  });

  test('valider sans proposition est refusé', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    toWriting(game);
    assert.equal(errorOf(game.validate(groups[1][0])), 'no_proposal');
  });

  test('un membre déconnecté ne bloque pas l’unanimité', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    toWriting(game);
    const [p, q] = groups[1];
    game.propose(p, 'Un chien');
    game.validate(p);
    assert.equal(game.teamOf(p).answer, null);
    game.setConnected(q, false);
    assert.equal(game.teamOf(p).answer, 'Un chien');
  });

  test('un membre qui se déconnecte avant d’avoir validé : les autres validés suffisent', () => {
    const { game, groups } = startedTeamsGame([1, 3, 1]);
    toWriting(game);
    const [p, q, r] = groups[1];
    game.propose(q, 'Un renard');
    game.validate(p);
    game.validate(q);
    game.setConnected(r, false);
    assert.equal(game.teamOf(p).answer, 'Un renard');
  });

  test('délai : le premier verrouillage lance le compte à rebours des autres équipes', () => {
    const { game, ids } = startedBaseGame(undefined, { graceSeconds: 20 });
    toWriting(game);
    assert.equal(game.deadline, null);
    game.propose(ids[0], 'Un chien');
    assert.equal(game.deadline, game.clock.now() + 20_000);
    game.clock.advance(19_999);
    assert.equal(game.tick(), false);
    assert.equal(game.phase, PHASES.WRITING);
    game.clock.advance(1);
    assert.equal(game.tick(), true);
    assert.equal(game.phase, PHASES.VOTING);
  });

  test('délai : un second verrouillage ne repousse pas l’échéance', () => {
    const { game, ids } = startedBaseGame(undefined, { graceSeconds: 20 });
    toWriting(game);
    game.propose(ids[0], 'Un chien');
    const deadline = game.deadline;
    game.clock.advance(5000);
    game.propose(ids[1], 'Un lion');
    assert.equal(game.deadline, deadline);
  });

  test('tout le monde a validé : passage immédiat au vote, sans attendre le délai', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Réponse ${i}`]));
    assert.equal(game.phase, PHASES.VOTING);
  });

  test('une équipe sans réponse à l’échéance n’apparaît pas dans les options', () => {
    const { game, ids } = startedBaseGame(undefined, { graceSeconds: 10 });
    toWriting(game);
    game.propose(ids[0], 'Un chien');
    game.propose(ids[1], 'Un lion');
    game.clock.advance(10_000);
    game.tick();
    assert.equal(game.phase, PHASES.VOTING);
    assert.equal(game.options.length, 3);
    assert.equal(game.options.filter((o) => o.kind === 'team').length, 2);
  });

  test('l’écran peut forcer le passage au vote', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    game.propose(ids[0], 'Un chien');
    expectOk(game.hostAdvance());
    assert.equal(game.phase, PHASES.VOTING);
  });
});

describe('chat d’équipe', () => {
  test('pas de chat pour une équipe d’un seul joueur', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    assert.equal(errorOf(game.chat(groups[0][0], 'salut')), 'no_chat');
  });

  test('les messages restent dans l’équipe, avec un séparateur par question', () => {
    const { game, groups } = startedTeamsGame([1, 2, 2]);
    const [p, q] = groups[1];
    expectOk(game.chat(p, '  bonjour   à tous '));
    const team = game.teamOf(p);
    assert.equal(team.chat[0].type, 'separator');
    assert.equal(team.chat[1].text, 'bonjour à tous');
    assert.equal(game.teamOf(groups[2][0]).chat.filter((m) => m.type === 'message').length, 0);
    assert.equal(team.chat[1].playerId, p);
    assert.ok(q);
  });

  test('texte invalide', () => {
    const { game, groups } = startedTeamsGame([1, 2, 2]);
    assert.equal(errorOf(game.chat(groups[1][0], '   ')), 'invalid_text');
    assert.equal(errorOf(game.chat(groups[1][0], 'x'.repeat(LIMITS.chatMax + 1))), 'invalid_text');
  });

  test('l’historique est borné', () => {
    const { game, groups } = startedTeamsGame([1, 2, 2]);
    for (let i = 0; i < LIMITS.chatHistory + 20; i += 1) game.chat(groups[1][0], `m${i}`);
    assert.equal(game.teamOf(groups[1][0]).chat.length, LIMITS.chatHistory);
  });

  test('actif pendant la phase de nom et de vote', () => {
    const game = newGame();
    const [a1, a2, b, c] = addPlayers(game, ['A1', 'A2', 'B', 'C']);
    game.createTeam(a1);
    game.joinTeam(a2, game.players.get(a1).teamId);
    game.createTeam(b);
    game.createTeam(c);
    expectOk(game.lockTeams());
    expectOk(game.chat(a1, 'un nom ?'));
  });
});

describe('vote et points', () => {
  function votingGame() {
    const { game, ids, teamIds } = startedBaseGame(['Ann', 'Bob', 'Cid']);
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'Chien'], [[ids[1]], 'Lion'], [[ids[2]], 'Chat']]);
    assert.equal(game.phase, PHASES.VOTING);
    return { game, ids, teamIds };
  }

  test('les options contiennent la vérité et chaque fausse réponse, numérotées à partir de 1', () => {
    const { game } = votingGame();
    assert.deepEqual(game.options.map((o) => o.id), [1, 2, 3, 4]);
    assert.equal(game.options.filter((o) => o.kind === 'truth').length, 1);
  });

  test('interdit de voter pour sa propre réponse', () => {
    const { game, ids } = votingGame();
    const own = optionOf(game, (o) => o.teamId === game.teamOf(ids[0]).id);
    assert.equal(errorOf(game.propose(ids[0], own.id)), 'own_answer');
  });

  test('option inconnue ou invalide', () => {
    const { game, ids } = votingGame();
    assert.equal(errorOf(game.propose(ids[0], 99)), 'invalid_vote');
    assert.equal(errorOf(game.propose(ids[0], 'abc')), 'invalid_vote');
    assert.equal(errorOf(game.propose(ids[0], 1.5)), 'invalid_vote');
  });

  test('un vote verrouillé ne change plus', () => {
    const { game, ids } = votingGame();
    const truth = optionOf(game, (o) => o.kind === 'truth');
    game.propose(ids[0], truth.id);
    assert.equal(errorOf(game.propose(ids[0], truth.id)), 'already_locked');
  });

  test('points : +2 par vote reçu sur sa fausse réponse, +1 pour la vraie réponse', () => {
    const { game, ids, teamIds } = votingGame();
    const truth = optionOf(game, (o) => o.kind === 'truth');
    const bob = optionOf(game, (o) => o.teamId === teamIds[1]);
    submitVotes(game, [[[ids[0]], bob.id], [[ids[1]], truth.id], [[ids[2]], bob.id]]);
    assert.equal(game.phase, PHASES.REVEAL);
    const gains = Object.fromEntries(teamIds.map((id) => [id, game.teams.get(id).gain]));
    assert.deepEqual(gains, { [teamIds[0]]: 0, [teamIds[1]]: 2 * 2 + 1, [teamIds[2]]: 0 });
  });

  test('réponses identiques de deux équipes : chacune garde ses propres votes', () => {
    const { game, ids, teamIds } = startedBaseGame(['Ann', 'Bob', 'Cid']);
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'Chien'], [[ids[1]], 'chien'], [[ids[2]], 'Chat']]);
    const annOption = optionOf(game, (o) => o.teamId === teamIds[0]);
    const bobOption = optionOf(game, (o) => o.teamId === teamIds[1]);
    assert.notEqual(annOption.id, bobOption.id);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, [[[ids[2]], annOption.id], [[ids[0]], truth.id], [[ids[1]], truth.id]]);
    assert.equal(game.teams.get(teamIds[0]).gain, 2 + 1);
    assert.equal(game.teams.get(teamIds[1]).gain, 0 + 1);
  });

  test('une équipe qui ne vote pas ne marque pas de point de vote', () => {
    const { game, ids, teamIds } = votingGame();
    const truth = optionOf(game, (o) => o.kind === 'truth');
    game.propose(ids[0], truth.id);
    game.clock.advance(30_000);
    game.tick();
    assert.equal(game.phase, PHASES.REVEAL);
    assert.equal(game.teams.get(teamIds[1]).gain, 0);
    assert.equal(game.teams.get(teamIds[0]).gain, 1);
  });

  test('délai du vote : même règle que l’écriture', () => {
    const { game, ids } = votingGame();
    assert.equal(game.deadline, null);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    game.propose(ids[0], truth.id);
    assert.equal(game.deadline, game.clock.now() + game.config.graceSeconds * 1000);
  });

  test('vote en équipe : unanimité, et pas de vote pour la réponse de sa propre équipe', () => {
    const { game, groups, teamIds } = startedTeamsGame([1, 2, 2]);
    toWriting(game);
    submitAnswers(game, [[groups[0], 'Rep A'], [groups[1], 'Rep B'], [groups[2], 'Rep C']]);
    assert.equal(game.phase, PHASES.VOTING);
    const own = optionOf(game, (o) => o.teamId === teamIds[1]);
    assert.equal(errorOf(game.propose(groups[1][0], own.id)), 'own_answer');
    const truth = optionOf(game, (o) => o.kind === 'truth');
    game.propose(groups[1][0], truth.id);
    game.validate(groups[1][0]);
    assert.equal(game.teams.get(teamIds[1]).vote, null);
    game.validate(groups[1][1]);
    assert.equal(game.teams.get(teamIds[1]).vote, truth.id);
  });
});

describe('révélation, classement et fin de partie', () => {
  function revealGame(config = {}) {
    const ctx = startedBaseGame(['Ann', 'Bob', 'Cid'], config);
    const { game, ids, teamIds } = ctx;
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'Chien'], [[ids[1]], 'Lion'], [[ids[2]], 'Chat']]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    const bob = optionOf(game, (o) => o.teamId === teamIds[1]);
    submitVotes(game, [[[ids[0]], bob.id], [[ids[1]], truth.id], [[ids[2]], bob.id]]);
    return { ...ctx, truth, bob };
  }

  test('la révélation suit l’ordre des numéros avec la vraie réponse en dernier', () => {
    const { game, truth } = revealGame();
    assert.equal(game.revealOrder.at(-1), truth.id);
    const fakes = game.revealOrder.slice(0, -1);
    assert.deepEqual(fakes, [...fakes].sort((a, b) => a - b));
    assert.equal(game.revealOrder.length, game.options.length);
  });

  test('une révélation par « Prêt », puis passage au classement', () => {
    const { game } = revealGame();
    for (let i = 0; i < game.revealOrder.length; i += 1) {
      assert.equal(game.phase, PHASES.REVEAL);
      assert.equal(game.revealCount, i);
      expectOk(game.hostAdvance());
    }
    assert.equal(game.phase, PHASES.REVEAL);
    assert.equal(game.revealCount, game.revealOrder.length);
    expectOk(game.hostAdvance());
    assert.equal(game.phase, PHASES.SCOREBOARD);
  });

  test('les scores ne changent qu’à l’arrivée au classement (ancien score conservé pour l’animation)', () => {
    const { game, teamIds } = revealGame();
    assert.equal(game.teams.get(teamIds[1]).score, 0);
    while (game.phase === PHASES.REVEAL) game.hostAdvance();
    assert.equal(game.teams.get(teamIds[1]).prevScore, 0);
    assert.equal(game.teams.get(teamIds[1]).score, 5);
  });

  test('le classement cumule les points d’une question à l’autre', () => {
    const { game, ids, teamIds } = revealGame();
    while (game.phase !== PHASES.QUESTION) game.hostAdvance();
    assert.equal(game.qIndex, 1);
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'A'], [[ids[1]], 'B'], [[ids[2]], 'C']]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, ids.map((id) => [[id], truth.id]));
    while (game.phase === PHASES.REVEAL) game.hostAdvance();
    assert.equal(game.teams.get(teamIds[1]).prevScore, 5);
    assert.equal(game.teams.get(teamIds[1]).score, 6);
    assert.equal(game.teams.get(teamIds[0]).score, 1);
  });

  test('la partie se termine après le nombre de questions réglé', () => {
    const { game, ids } = revealGame({ totalQuestions: 2 });
    while (game.phase !== PHASES.QUESTION) game.hostAdvance();
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'A'], [[ids[1]], 'B'], [[ids[2]], 'C']]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, ids.map((id) => [[id], truth.id]));
    while (game.phase !== PHASES.FINAL) game.hostAdvance();
    assert.equal(game.phase, PHASES.FINAL);
    assert.equal(errorOf(game.hostAdvance()), 'wrong_phase');
  });

  test('rejouer : scores remis à zéro, équipes, noms et couleurs conservés, nouvelles questions', () => {
    const { game, ids, teamIds } = revealGame({ totalQuestions: 2 });
    const firstQuestions = game.order.map((q) => q.id);
    const colors = teamIds.map((id) => game.teams.get(id).color);
    const names = teamIds.map((id) => game.teams.get(id).name);
    while (game.phase !== PHASES.QUESTION) game.hostAdvance();
    toWriting(game);
    submitAnswers(game, [[[ids[0]], 'A'], [[ids[1]], 'B'], [[ids[2]], 'C']]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, ids.map((id) => [[id], truth.id]));
    while (game.phase !== PHASES.FINAL) game.hostAdvance();
    expectOk(game.replay());
    assert.equal(game.phase, PHASES.QUESTION);
    assert.ok(teamIds.every((id) => game.teams.get(id).score === 0));
    assert.deepEqual(teamIds.map((id) => game.teams.get(id).color), colors);
    assert.deepEqual(teamIds.map((id) => game.teams.get(id).name), names);
    assert.ok(game.order.every((q) => !firstQuestions.includes(q.id)));
  });

  test('rejouer n’est possible qu’en fin de partie', () => {
    const { game } = startedBaseGame();
    assert.equal(errorOf(game.replay()), 'wrong_phase');
  });
});

describe('déconnexion et reconnexion', () => {
  test('marquer inconnu', () => {
    const game = newGame();
    assert.equal(errorOf(game.setConnected('zzz', false)), 'unknown_player');
  });

  test('un joueur reconnecté retrouve son équipe et son état', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    toWriting(game);
    const [p, q] = groups[1];
    game.propose(p, 'Un chien');
    game.validate(p);
    game.setConnected(q, false);
    game.setConnected(q, true);
    assert.equal(game.teamOf(q).id, game.teamOf(p).id);
    assert.equal(game.players.get(q).connected, true);
  });

  test('si la dernière équipe à valider est déconnectée, le délai finit la phase', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    game.setConnected(ids[2], false);
    game.propose(ids[0], 'A');
    game.propose(ids[1], 'B');
    assert.equal(game.phase, PHASES.WRITING);
    game.clock.advance(30_000);
    game.tick();
    assert.equal(game.phase, PHASES.VOTING);
  });
});


describe('thèmes des questions', () => {
  const THEMED = [
    { id: 'a1', text: 'A1 ?', answer: 'x1', tags: ['Insolite', 'Histoire'] },
    { id: 'a2', text: 'A2 ?', answer: 'x2', tags: ['Insolite'] },
    { id: 'a3', text: 'A3 ?', answer: 'x3', tags: ['Insolite', 'Noël'] },
    { id: 'h1', text: 'H1 ?', answer: 'y1', tags: ['Histoire'] },
    { id: 'h2', text: 'H2 ?', answer: 'y2', tags: ['Histoire'] },
    { id: 'n1', text: 'N1 ?', answer: 'z1', tags: ['Noël'] },
    { id: 'd1', text: 'D1 ?', answer: 'w1' },
  ];
  const themed = (config = {}) => newGame({ mode: 'base', totalQuestions: 3, ...config }, { questions: THEMED });

  test('liste des thèmes avec leur nombre de questions (une question compte une fois par thème)', () => {
    const game = themed();
    assert.deepEqual(game.themeList, [
      { name: 'Divers', count: 1 },
      { name: 'Histoire', count: 3 },
      { name: 'Insolite', count: 3 },
      { name: 'Noël', count: 2 },
    ]);
  });

  test('tous les thèmes par défaut ; une question sans tag va dans « Divers »', () => {
    const game = themed();
    assert.equal(game.config.themes, null);
    assert.deepEqual(game.pool(), { available: 7, needed: 3, ok: true });
  });

  test('réglage des thèmes : liste connue, doublons ignorés, null pour tout, inconnu refusé', () => {
    const game = themed();
    expectOk(game.configure({ themes: ['Histoire', 'Histoire', 'Noël'] }));
    assert.deepEqual(game.config.themes, ['Histoire', 'Noël']);
    assert.equal(game.pool().available, 5);
    assert.equal(errorOf(game.configure({ themes: ['Inconnu'] })), 'invalid_config');
    assert.equal(errorOf(game.configure({ themes: 'Histoire' })), 'invalid_config');
    assert.equal(errorOf(game.configure({ themes: [3] })), 'invalid_config');
    expectOk(game.configure({ themes: [] }));
    assert.equal(game.pool().available, 0);
    expectOk(game.configure({ themes: null }));
    assert.equal(game.config.themes, null);
  });

  test('seules les questions des thèmes choisis sont tirées', () => {
    const game = themed({ themes: ['Noël'], totalQuestions: 2 });
    addPlayers(game, ['Ann', 'Bob', 'Cid']);
    expectOk(game.start());
    assert.deepEqual(game.order.map((q) => q.id).sort(), ['a3', 'n1']);
  });

  test('pas assez de questions : la partie ne démarre pas (mode base) et l’erreur donne les chiffres', () => {
    const game = themed({ themes: ['Noël'], totalQuestions: 3 });
    addPlayers(game, ['Ann', 'Bob', 'Cid']);
    const result = game.start();
    assert.equal(errorOf(result), 'not_enough_questions');
    assert.equal(result.available, 2);
    assert.equal(result.needed, 3);
    assert.equal(game.phase, PHASES.LOBBY);
    expectOk(game.configure({ themes: ['Noël', 'Histoire'] }));
    expectOk(game.start());
  });

  test('pas assez de questions : les équipes ne se verrouillent pas (mode équipes)', () => {
    const game = newGame({ mode: 'teams', totalQuestions: 3, themes: ['Divers'] }, { questions: THEMED });
    const ids = addPlayers(game, ['Ann', 'Bob', 'Cid']);
    ids.forEach((id) => expectOk(game.createTeam(id)));
    assert.equal(errorOf(game.lockTeams()), 'not_enough_questions');
    assert.equal(game.phase, PHASES.LOBBY);
    expectOk(game.configure({ themes: null }));
    expectOk(game.lockTeams());
  });

  test('rejouer reste dans les thèmes choisis, sans manquer de questions', () => {
    const game = themed({ themes: ['Noël'], totalQuestions: 2 });
    addPlayers(game, ['Ann', 'Bob', 'Cid']);
    expectOk(game.start());
    game.phase = PHASES.FINAL;
    expectOk(game.replay());
    assert.deepEqual(game.order.map((q) => q.id).sort(), ['a3', 'n1']);
  });
});