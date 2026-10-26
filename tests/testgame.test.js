import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASES } from '../game/engine.js';
import { TEST_CODE, TEST_QUESTIONS, addBots, createBots } from '../game/testGame.js';
import { makeClock, seededRng, expectOk } from './helpers.js';
import { startServer, openClient } from './server-helpers.js';

function testGame(clock) {
  const game = new Game({
    code: TEST_CODE,
    questions: [...TEST_QUESTIONS],
    config: { totalQuestions: TEST_QUESTIONS.length },
    now: clock.now,
    rng: seededRng(5),
  });
  const bots = createBots(game, addBots(game));
  return { game, bots };
}

describe('robots de la partie de test', () => {
  test('les robots font une partie complète de 2 questions sans intervention', () => {
    const clock = makeClock();
    const { game, bots } = testGame(clock);
    bots.step();
    assert.equal(game.teams.size, 3);
    expectOk(game.lockTeams());
    expectOk(game.start());
    for (let i = 0; i < 100 && game.phase !== PHASES.FINAL; i += 1) {
      clock.advance(5000);
      bots.step();
    }
    assert.equal(game.phase, PHASES.FINAL);
    assert.equal(game.order.length, 2);
  });

  test('ils votent pour une réponse qui n’est pas celle de leur équipe', () => {
    const clock = makeClock();
    const { game, bots } = testGame(clock);
    bots.step();
    expectOk(game.lockTeams());
    expectOk(game.start());
    while (game.phase !== PHASES.REVEAL) {
      clock.advance(5000);
      bots.step();
    }
    for (const team of game.teamList()) {
      const option = game.options.find((o) => o.id === team.vote);
      assert.ok(option, `vote de ${team.name}`);
      assert.notEqual(option.teamId, team.id);
    }
  });

  test('en mode « base », chaque robot garde sa propre équipe', () => {
    const clock = makeClock();
    const { game, bots } = testGame(clock);
    expectOk(game.configure({ mode: 'base' }));
    bots.step();
    assert.equal(game.teams.size, 3);
    expectOk(game.start());
    assert.equal(game.phase, PHASES.QUESTION);
  });

  test('un humain peut rejoindre : la partie attend sa validation', () => {
    const clock = makeClock();
    const { game, bots } = testGame(clock);
    const human = expectOk(game.addPlayer('Zoé')).player.id;
    expectOk(game.createTeam(human));
    bots.step();
    expectOk(game.lockTeams());
    assert.equal(game.teams.size, 4);
    expectOk(game.start());
    for (let i = 0; i < 20; i += 1) {
      clock.advance(5000);
      bots.step();
    }
    assert.equal(game.phase, PHASES.QUESTION);
    expectOk(game.setReady(human));
    assert.equal(game.phase, PHASES.WRITING);
  });
});

describe('salon de test', () => {
  let server;
  const clients = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await server?.close();
    server = null;
  });

  test('host:create avec test : code TEST, robots, 2 questions, banque réelle intacte', async () => {
    server = await startServer();
    const host = await openClient(server.url);
    clients.push(host);
    const result = await host.emit('host:create', { config: {}, test: true });
    assert.equal(result.code, TEST_CODE);
    const state = await host.waitFor((s) => s.players.length === 3 && s.teams.length === 3, 'robots et équipes');
    assert.equal(state.test, true);
    assert.equal(state.config.totalQuestions, 2);
    assert.deepEqual(state.themes, [{ name: 'Test', count: 2 }]);
  });

  test('une partie normale n’est pas une partie de test et n’a jamais le code TEST', async () => {
    server = await startServer();
    const host = await openClient(server.url);
    clients.push(host);
    const result = await host.emit('host:create', { config: {} });
    assert.notEqual(result.code, TEST_CODE);
    const state = await host.waitFor((s) => s.phase === 'lobby', 'salon');
    assert.equal(state.test, false);
    assert.equal(state.players.length, 0);
  });

  test('relancer une partie de test remplace la précédente', async () => {
    server = await startServer();
    const first = await openClient(server.url);
    clients.push(first);
    await first.emit('host:create', { config: {}, test: true });
    const second = await openClient(server.url);
    clients.push(second);
    const result = await second.emit('host:create', { config: {}, test: true });
    assert.equal(result.code, TEST_CODE);
    assert.equal(server.rooms.size, 1);
    assert.equal(server.rooms.get(TEST_CODE).hostToken, result.token);
  });

  test('les robots jouent pendant que l’écran suit la partie', async () => {
    server = await startServer();
    const host = await openClient(server.url);
    clients.push(host);
    await host.emit('host:create', { config: {}, test: true });
    await host.waitFor((s) => s.teams.length === 3, 'équipes');
    expectOk(await host.emit('host:lockTeams'));
    expectOk(await host.emit('host:start'));
    const until = async (phase) => {
      for (let i = 0; i < 60 && host.state.phase !== phase; i += 1) {
        server.clock.advance(5000);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.equal(host.state.phase, phase);
    };
    await until('writing');
    await until('voting');
    await until('reveal');
    assert.equal(server.history.count('test-ocean') + server.history.count('test-pieuvre'), 0);
  });
});
