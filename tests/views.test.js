import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES } from '../game/engine.js';
import { publicView, hostView, playerView } from '../game/views.js';
import {
  newGame, addPlayers, startedBaseGame, startedTeamsGame, toWriting, submitAnswers, submitVotes, optionOf,
} from './helpers.js';

const json = (value) => JSON.stringify(value);

describe('confidentialité des vues', () => {
  test('la vraie réponse n’apparaît ni dans la question ni avant le vote', () => {
    const { game, ids } = startedBaseGame();
    const truth = game.question.answer;
    assert.ok(!json(hostView(game)).includes(truth));
    toWriting(game);
    assert.ok(!json(hostView(game)).includes(truth));
    assert.ok(!json(playerView(game, ids[0])).includes(truth));
  });

  test('pendant le vote, rien n’indique quelle option est vraie ni qui a écrit quoi', () => {
    const { game, ids } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Réponse ${i}`]));
    for (const view of [hostView(game), playerView(game, ids[0])]) {
      assert.equal(view.phase, PHASES.VOTING);
      assert.equal(view.options.length, 4);
      for (const option of view.options) {
        assert.deepEqual(Object.keys(option).sort(), ['id', 'revealed', 'text']);
      }
    }
  });

  test('les options se dévoilent une à une, la vérité en dernier', () => {
    const { game, ids, teamIds } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Réponse ${i}`]));
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, ids.map((id) => [[id], truth.id]));
    let view = hostView(game);
    assert.equal(view.options.filter((o) => o.revealed).length, 0);
    for (let i = 1; i <= view.revealTotal; i += 1) {
      game.hostAdvance();
      view = hostView(game);
      assert.equal(view.options.filter((o) => o.revealed).length, i);
    }
    const revealedTruth = view.options.find((o) => o.kind === 'truth');
    assert.equal(revealedTruth.text, game.question.answer);
    assert.deepEqual(revealedTruth.voters.sort(), [...teamIds].sort());
    assert.equal(revealedTruth.points, 3);
  });

  test('le tchat, la proposition et la réponse d’une équipe ne sortent pas de l’équipe', () => {
    const { game, groups } = startedTeamsGame([1, 2, 2]);
    toWriting(game);
    const [p] = groups[1];
    game.chat(p, 'secret-chat');
    game.propose(p, 'secret-proposition');
    const outsider = groups[2][0];
    const mate = groups[1][1];
    assert.ok(!json(hostView(game)).includes('secret'));
    assert.ok(!json(playerView(game, outsider)).includes('secret'));
    assert.ok(!json(playerView(game, groups[0][0])).includes('secret'));
    const mateView = playerView(game, mate);
    assert.ok(json(mateView).includes('secret-chat'));
    assert.equal(mateView.team.proposal.value, 'secret-proposition');
  });

  test('la vue publique ne contient que des compteurs de progression par équipe', () => {
    const { game, groups, teamIds } = startedTeamsGame([1, 2, 2]);
    toWriting(game);
    game.propose(groups[1][0], 'Un chien');
    game.validate(groups[1][0]);
    const team = publicView(game).teams.find((t) => t.id === teamIds[1]);
    assert.deepEqual(team.progress, { locked: false, hasProposal: true, validated: 1, size: 2 });
  });

  test('une équipe sans chat (un seul joueur) reçoit hasChat=false', () => {
    const { game, groups } = startedTeamsGame([1, 2, 2]);
    assert.equal(playerView(game, groups[0][0]).team.hasChat, false);
    assert.equal(playerView(game, groups[1][0]).team.hasChat, true);
  });

  test('aucune photo (donnée brute) dans les vues : uniquement un indicateur et une version', () => {
    const { game, ids } = startedBaseGame();
    game.setPhoto(ids[0], 'data:image/jpeg;base64,/9j/SECRETPIXELS');
    assert.ok(!json(hostView(game)).includes('SECRETPIXELS'));
    const entry = hostView(game).players.find((p) => p.id === ids[0]);
    assert.equal(entry.hasPhoto, true);
    assert.equal(entry.photoVersion, 1);
  });

  test('le classement porte le rang courant et le rang précédent', () => {
    const { game, ids, teamIds } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Réponse ${i}`]));
    const bobOption = optionOf(game, (o) => o.teamId === teamIds[1]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, [[[ids[0]], bobOption.id], [[ids[1]], truth.id], [[ids[2]], bobOption.id]]);
    while (game.phase === PHASES.REVEAL) game.hostAdvance();
    const view = hostView(game);
    assert.equal(view.phase, PHASES.SCOREBOARD);
    const bob = view.ranking.find((r) => r.id === teamIds[1]);
    assert.equal(bob.rank, 1);
    assert.equal(bob.score, 5);
    assert.equal(view.teams.find((t) => t.id === teamIds[1]).gain, 5);
  });

  test('le gagnant est désigné en fin de partie (égalité : plusieurs gagnants)', () => {
    const { game, ids } = startedBaseGame(['Ann', 'Bob', 'Cid'], { totalQuestions: 1 });
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Réponse ${i}`]));
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, ids.map((id) => [[id], truth.id]));
    while (game.phase !== PHASES.FINAL) game.hostAdvance();
    assert.equal(hostView(game).winners.length, 3);
  });

  test('vue joueur inconnue', () => {
    const { game } = startedBaseGame();
    assert.equal(playerView(game, 'zzz'), null);
  });

  test('canLock et canStart suivent l’état du salon', () => {
    const game = newGame();
    const ids = addPlayers(game, ['Ann', 'Bob', 'Cid']);
    assert.equal(hostView(game).canLock, false);
    ids.forEach((id) => game.createTeam(id));
    assert.equal(hostView(game).canLock, true);
    game.lockTeams();
    assert.deepEqual(hostView(game).teamsNamed, { named: 3, total: 3 });
    assert.equal(hostView(game).canStart, true);
  });

  test('délai restant exposé en millisecondes', () => {
    const { game, ids } = startedBaseGame(undefined, { graceSeconds: 20 });
    toWriting(game);
    assert.equal(hostView(game).deadlineIn, null);
    game.propose(ids[0], 'A');
    game.clock.advance(5000);
    assert.equal(hostView(game).deadlineIn, 15_000);
  });
});
