import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_COLORS as ENGINE_COLORS } from '../game/engine.js';
import { TEAM_COLORS } from '../shared/palette.js';
import { ERROR_MESSAGES, errorMessage } from '../public/lib/messages.js';
import {
  avatarSpec, remainingMs, formatSeconds, chatProposalValue, progressText, standing, rankLabel, ownResult, teamsInOrder,
} from '../public/lib/model.js';
import { buildScoreboardModel } from '../public/scoreboard.js';
import { squareCrop, fitsLimit, SELFIE_MAX_CHARS } from '../public/avatar.js';
import { hostView } from '../game/views.js';
import { startedBaseGame, startedTeamsGame, toWriting, submitAnswers, submitVotes, optionOf } from './helpers.js';
import { PHASES } from '../game/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('messages d’erreur', () => {
  test('chaque code d’erreur du moteur et du serveur a un message en français', () => {
    const codes = new Set();
    for (const file of ['game/engine.js', 'server/app.js', 'shared/protocol.js']) {
      const source = read(file);
      for (const match of source.matchAll(/fail\('([a-z_]+)'/g)) codes.add(match[1]);
      for (const match of source.matchAll(/error: '([a-z_]+)'/g)) codes.add(match[1]);
    }
    for (const extra of ['timeout', 'protocol_mismatch']) codes.add(extra);
    assert.ok(codes.size > 20);
    const missing = [...codes].filter((code) => !ERROR_MESSAGES[code]);
    assert.deepEqual(missing, []);
  });

  test('code inconnu : message générique', () => {
    assert.equal(errorMessage('zzz'), 'Erreur (zzz).');
    assert.match(errorMessage('is_truth'), /vraie/);
  });
});

describe('modèle d’affichage', () => {
  test('palette partagée identique à celle du moteur', () => {
    assert.deepEqual([...ENGINE_COLORS], [...TEAM_COLORS]);
  });

  test('avatar : photo versionnée ou initiales, couleur d’équipe', () => {
    const withPhoto = avatarSpec({ id: 'p1', name: 'Ann Lee', hasPhoto: true, photoVersion: 3 }, '#ff0000', 'ABCD');
    assert.equal(withPhoto.src, '/photos/ABCD/p1.jpg?v=3');
    assert.equal(withPhoto.color, '#ff0000');
    assert.equal(withPhoto.initials, 'AL');
    const without = avatarSpec({ id: 'p2', name: 'bob', hasPhoto: false, photoVersion: 0 }, undefined, 'ABCD');
    assert.equal(without.src, null);
    assert.equal(without.initials, 'BO');
    assert.equal(without.color, '#6b7280');
  });

  test('décompte du délai', () => {
    assert.equal(remainingMs(null, 0, 10), null);
    assert.equal(remainingMs(20_000, 1000, 6000), 15_000);
    assert.equal(remainingMs(1000, 0, 5000), 0);
    assert.equal(formatSeconds(14_001), '15');
    assert.equal(formatSeconds(0), '0');
  });

  test('proposer un message du tchat : tout texte en nom et réponse, numéro en vote', () => {
    const options = [{ id: 1 }, { id: 2 }];
    assert.equal(chatProposalValue('Les Lions', 'naming', options), 'Les Lions');
    assert.equal(chatProposalValue('un chien', 'writing', options), 'un chien');
    assert.equal(chatProposalValue('2', 'voting', options), 2);
    assert.equal(chatProposalValue(' n°1 ', 'voting', options), 1);
    assert.equal(chatProposalValue('7', 'voting', options), null);
    assert.equal(chatProposalValue('bof', 'voting', options), null);
    assert.equal(chatProposalValue('2', 'reveal', options), null);
  });

  test('texte d’avancement d’une équipe', () => {
    const progress = (extra) => ({ progress: { locked: false, hasProposal: false, validated: 0, size: 3, ...extra } });
    assert.equal(progressText(progress({}), 'writing'), 'Discute…');
    assert.equal(progressText(progress({ hasProposal: true, validated: 2 }), 'writing'), '2/3 ont validé');
    assert.equal(progressText(progress({ locked: true }), 'writing'), 'Validé');
    assert.equal(progressText(progress({ locked: true }), 'naming'), 'Nom adopté');
    assert.equal(progressText(progress({ size: 1 }), 'writing'), 'Réfléchit…');
    assert.equal(progressText(progress({ size: 1, hasProposal: true }), 'writing'), 'Validé');
  });

  test('rang lisible', () => {
    assert.equal(rankLabel(1), '1er');
    assert.equal(rankLabel(3), '3e');
    assert.equal(rankLabel(2, true), '2e ex æquo');
  });

  test('position d’une équipe après une question', () => {
    const { game, ids, teamIds } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Fausse ${i}`]));
    const bob = optionOf(game, (o) => o.teamId === teamIds[1]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, [[[ids[0]], bob.id], [[ids[1]], truth.id], [[ids[2]], bob.id]]);
    const midReveal = hostView(game);
    assert.equal(ownResult(midReveal, teamIds[1]), null);
    while (game.phase === PHASES.REVEAL) game.hostAdvance();
    const view = hostView(game);
    assert.deepEqual(standing(view, teamIds[1]), { rank: 1, total: 3, score: 5, gain: 5, tied: false });
    assert.deepEqual(standing(view, teamIds[0]), { rank: 2, total: 3, score: 0, gain: 0, tied: true });
    assert.equal(standing(view, 'zzz'), null);
    assert.equal(teamsInOrder(view)[0].id, teamIds[1]);
  });

  test('résultat de sa propre réponse une fois tout révélé', () => {
    const { game, ids, teamIds } = startedBaseGame();
    toWriting(game);
    submitAnswers(game, ids.map((id, i) => [[id], `Fausse ${i}`]));
    const bob = optionOf(game, (o) => o.teamId === teamIds[1]);
    const truth = optionOf(game, (o) => o.kind === 'truth');
    submitVotes(game, [[[ids[0]], bob.id], [[ids[1]], truth.id], [[ids[2]], bob.id]]);
    while (game.revealCount < game.revealOrder.length) game.hostAdvance();
    assert.deepEqual(ownResult(hostView(game), teamIds[1]), { answerVotes: 2 });
  });
});

describe('classement animé : modèle', () => {
  const team = (id, score, prevScore, extra = {}) => ({ id, name: id, color: '#fff', score, prevScore, gain: score - prevScore, ...extra });

  test('positions avant/après, largeurs relatives au leader', () => {
    const { rows, max } = buildScoreboardModel([team('a', 2, 2), team('b', 5, 1), team('c', 3, 3)]);
    assert.equal(max, 5);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
    const b = rows[0];
    assert.equal(b.index, 0);
    assert.equal(b.prevIndex, 2);
    assert.equal(b.pct, 100);
    assert.equal(b.prevPct, 20);
    assert.equal(b.gain, 4);
    assert.equal(rows[1].prevIndex, 0);
    assert.equal(rows[2].prevIndex, 1);
  });

  test('début de partie : aucune barre, ordre stable', () => {
    const { rows } = buildScoreboardModel([team('a', 0, 0), team('b', 0, 0), team('c', 0, 0)]);
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
    assert.ok(rows.every((r) => r.pct === 0 && r.prevPct === 0 && r.index === r.prevIndex));
  });

  test('égalité : l’ordre de création est conservé, rang partagé', () => {
    const { rows } = buildScoreboardModel([team('a', 3, 0), team('b', 3, 0), team('c', 1, 0)]);
    assert.deepEqual(rows.map((r) => [r.id, r.rank]), [['a', 1], ['b', 1], ['c', 3]]);
  });

  test('une équipe qui dépasse une autre change de position', () => {
    const { rows } = buildScoreboardModel([team('a', 4, 4), team('b', 6, 3)]);
    assert.deepEqual(rows.map((r) => [r.id, r.prevIndex, r.index]), [['b', 1, 0], ['a', 0, 1]]);
  });
});

describe('selfie', () => {
  test('recadrage carré centré', () => {
    assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, size: 300 });
    assert.deepEqual(squareCrop(300, 400), { sx: 0, sy: 50, size: 300 });
    assert.deepEqual(squareCrop(256, 256), { sx: 0, sy: 0, size: 256 });
  });

  test('limite de taille et format', () => {
    assert.equal(fitsLimit('data:image/jpeg;base64,AAAA'), true);
    assert.equal(fitsLimit('data:image/png;base64,AAAA'), false);
    assert.equal(fitsLimit(`data:image/jpeg;base64,${'A'.repeat(SELFIE_MAX_CHARS)}`), false);
    assert.equal(fitsLimit(null), false);
  });

  test('la limite du client reste sous celle du serveur', () => {
    const serverMax = Number(/photoMaxChars: ([\d_]+)/.exec(read('game/engine.js'))[1].replaceAll('_', ''));
    assert.ok(SELFIE_MAX_CHARS <= serverMax);
  });
});

describe('pages et dépendances du front', () => {
  test('les pages chargent socket.io puis leur module, sans script inline', () => {
    for (const page of ['player', 'host']) {
      const html = read(`public/${page}.html`);
      assert.match(html, /<script src="\/socket\.io\/socket\.io\.js"><\/script>/);
      assert.match(html, new RegExp(`<script type="module" src="/${page}\\.js"></script>`));
      assert.ok(!/<script>[^<]/.test(html), 'script inline interdit par la CSP');
    }
  });

  test('le front n’utilise ni innerHTML ni eval', () => {
    for (const file of ['player.js', 'host.js', 'rules.js', 'scoreboard.js', 'lib/dom.js', 'lib/ui.js']) {
      const source = read(`public/${file}`);
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(source), file);
    }
  });

  test('le front n’importe aucun fichier serveur (banque de questions, moteur)', () => {
    for (const file of ['player.js', 'host.js', 'rules.js', 'scoreboard.js', 'avatar.js', 'lib/model.js', 'lib/net.js', 'lib/ui.js']) {
      assert.ok(!/from '\.\.?\/(?:\.\.\/)?(?:game|server)\//.test(read(`public/${file}`)), file);
    }
  });
});
