import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, PROTOCOL_VERSION, SERVER_EVENTS, validatePayload } from '../shared/protocol.js';
import { hostView, playerView } from '../game/views.js';
import { startedBaseGame, startedTeamsGame } from './helpers.js';
import { startServer, Client, createRoom, joinPlayer } from './server-helpers.js';

describe('contrat des événements Socket.IO', () => {
  test('version du protocole et liste des commandes figées (à mettre à jour volontairement)', () => {
    assert.equal(PROTOCOL_VERSION, 1);
    assert.deepEqual(Object.keys(COMMANDS).sort(), [
      'host:advance', 'host:configure', 'host:create', 'host:end', 'host:kick', 'host:lockTeams',
      'host:randomize', 'host:replay', 'host:resetHistory', 'host:resume', 'host:start', 'host:unlockTeams',
      'player:join', 'player:photo', 'player:ready', 'player:resume',
      'team:chat', 'team:color', 'team:create', 'team:join', 'team:propose', 'team:unvalidate', 'team:validate',
    ]);
    assert.deepEqual(SERVER_EVENTS, { HELLO: 'hello', STATE: 'state', ENDED: 'ended' });
  });

  test('validation des charges utiles', () => {
    assert.equal(validatePayload('player:join', { code: 'ABCD', name: 'Ann' }).ok, true);
    assert.deepEqual(validatePayload('player:join', { code: 'ABCD' }), { ok: false, error: 'invalid_payload', field: 'name' });
    assert.equal(validatePayload('player:join', { code: 4, name: 'x' }).ok, false);
    assert.equal(validatePayload('player:join', 'texte').ok, false);
    assert.equal(validatePayload('player:join', [1]).ok, false);
    assert.equal(validatePayload('inconnu', {}).error, 'unknown_command');
    assert.equal(validatePayload('host:start').ok, true);
    assert.equal(validatePayload('host:start', null).ok, true);
    assert.equal(validatePayload('team:propose', { value: 3 }).ok, true);
    assert.equal(validatePayload('team:propose', { value: 'x' }).ok, true);
    assert.equal(validatePayload('team:propose', { value: {} }).ok, false);
    assert.equal(validatePayload('team:propose', { value: Number.NaN }).ok, false);
    assert.equal(validatePayload('player:photo', { photo: null }).ok, true);
    assert.equal(validatePayload('player:photo', { photo: 12 }).ok, false);
    assert.equal(validatePayload('player:ready', {}).ok, true);
    assert.equal(validatePayload('player:ready', { ready: 'oui' }).ok, false);
    assert.equal(validatePayload('host:create', {}).ok, true);
    assert.equal(validatePayload('host:create', { config: [] }).ok, false);
    assert.equal(validatePayload('player:photo', { photo: 'x'.repeat(300_000) }).ok, false);
  });

  test('forme de la vue écran', () => {
    const { game } = startedBaseGame();
    assert.deepEqual(Object.keys(hostView(game)).sort(), [
      'canLock', 'canStart', 'code', 'config', 'deadlineIn', 'history', 'limits', 'options', 'phase', 'players', 'pool',
      'question',
      'ranking', 'ready', 'revealCount', 'revealTotal', 'role', 'selectedThemes', 'teams', 'teamsNamed', 'test', 'themes',
      'unassigned', 'winners',
    ]);
  });

  test('forme de la vue joueur', () => {
    const { game, groups } = startedTeamsGame([1, 2, 1]);
    const view = playerView(game, groups[1][0]);
    assert.deepEqual(Object.keys(view).sort(), [
      'code', 'config', 'deadlineIn', 'limits', 'me', 'options', 'phase', 'players', 'question',
      'ranking', 'ready', 'revealCount', 'revealTotal', 'role', 'team', 'teams', 'teamsNamed', 'test', 'winners',
    ]);
    assert.deepEqual(Object.keys(view.me).sort(), ['id', 'name', 'ready', 'teamId']);
    assert.deepEqual(Object.keys(view.team).sort(), [
      'answer', 'chat', 'hasChat', 'id', 'locked', 'notice', 'ownOptionId', 'proposal', 'validations', 'vote',
    ]);
    const team = view.teams[0];
    assert.deepEqual(Object.keys(team).sort(), ['color', 'gain', 'id', 'memberIds', 'name', 'prevScore', 'progress', 'score']);
  });
});

describe('connexion et protocole', () => {
  let server;
  const clients = [];
  const track = (client) => {
    clients.push(client);
    return client;
  };

  after(async () => {
    clients.forEach((c) => c.close());
    await server?.close();
  });

  test('le serveur annonce sa version de protocole à la connexion', async () => {
    server = await startServer();
    const client = track(await new Client(server.url).open());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const hello = client.events.find((e) => e.name === 'hello');
    assert.equal(hello.payload.protocol, PROTOCOL_VERSION);
  });

  test('un client avec un protocole obsolète est refusé avec un message explicite', async () => {
    const stale = new Client(server.url, { protocol: PROTOCOL_VERSION - 1 });
    track(stale);
    await assert.rejects(stale.open(), (error) => error.message === 'protocol_mismatch');
  });

  test('un client sans numéro de protocole est refusé', async () => {
    const none = new Client(server.url, { protocol: null });
    track(none);
    await assert.rejects(none.open(), /protocol_mismatch/);
  });

  test('charge utile invalide et commande interdite sont refusées', async () => {
    const client = track(await new Client(server.url).open());
    assert.deepEqual(await client.emit('player:join', { code: 12 }), { ok: false, error: 'invalid_payload', field: 'code' });
    assert.equal((await client.emit('host:start')).error, 'not_authorized');
    assert.equal((await client.emit('team:chat', { text: 'x' })).error, 'not_authorized');
    assert.equal((await client.emit('player:join', { code: 'ZZZZ', name: 'Ann' })).error, 'unknown_room');
  });

  test('un joueur ne peut pas utiliser les commandes de l’hôte', async () => {
    const { code } = await createRoom(server).then((r) => {
      track(r.host);
      return r;
    });
    const { client } = await joinPlayer(server, code, 'Ann');
    track(client);
    assert.equal((await client.emit('host:start')).error, 'not_authorized');
    assert.equal((await client.emit('host:end')).error, 'not_authorized');
  });

  test('l’accusé de réponse ne contient jamais d’objet interne', async () => {
    const { host, code } = await createRoom(server);
    track(host);
    const { client } = await joinPlayer(server, code, 'Bob');
    track(client);
    const reply = await client.emit('team:create');
    assert.deepEqual(reply, { ok: true });
    const joined = await new Client(server.url).open();
    track(joined);
    const result = await joined.emit('player:join', { code, name: 'Cid' });
    assert.deepEqual(Object.keys(result).sort(), ['code', 'ok', 'playerId', 'token']);
  });
});
