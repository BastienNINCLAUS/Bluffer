import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createRoom, joinPlayer, gameOf } from './server-helpers.js';

let server;
const clients = [];

async function setup(options) {
  server = await startServer(options);
  return server;
}

function track(...items) {
  clients.push(...items);
  return items.length === 1 ? items[0] : items;
}

async function join(code, name) {
  const player = await joinPlayer(server, code, name);
  track(player.client);
  return player;
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server?.close();
  server = null;
});

const allStates = (...parties) => parties.flatMap((c) => c.states);

describe('partie complète en mode base', () => {
  test('de la salle d’attente au classement final, sans fuite de la vraie réponse', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base', totalQuestions: 2 });
    track(host);
    const ann = await join(code, 'Ann');
    const bob = await join(code, 'Bob');
    const cid = await join(code, 'Cid');
    const players = [ann, bob, cid];
    await host.waitFor((s) => s.players.length === 3, '3 joueurs');
    assert.deepEqual((await host.emit('host:start')), { ok: true });

    const game = gameOf(server, code);
    for (let q = 0; q < 2; q += 1) {
      await host.waitFor((s) => s.phase === 'question' && s.question.index === q + 1, 'question');
      assert.equal(host.state.ready.total, 3);
      for (const p of players) assert.equal((await p.client.emit('player:ready')).ok, true);
      await host.waitFor((s) => s.phase === 'writing', 'écriture');

      for (const [i, p] of players.entries()) {
        assert.equal((await p.client.emit('team:propose', { value: `Fausse ${q}-${i}` })).ok, true);
      }
      await host.waitFor((s) => s.phase === 'voting', 'vote');
      assert.equal(host.state.options.length, 4);

      const truthId = game.options.find((o) => o.kind === 'truth').id;
      for (const p of players) {
        const reply = await p.client.emit('team:propose', { value: truthId });
        assert.equal(reply.ok, true);
      }
      await host.waitFor((s) => s.phase === 'reveal', 'révélation');
      for (let i = 0; i < 4; i += 1) assert.equal((await host.emit('host:advance')).ok, true);
      await host.waitFor((s) => s.revealCount === 4, 'tout révélé');
      assert.equal((await host.emit('host:advance')).ok, true);
      await host.waitFor((s) => s.phase === 'scoreboard', 'classement');
      assert.equal(host.state.teams.every((t) => t.gain === 1), true);
      assert.equal((await host.emit('host:advance')).ok, true);
    }

    await host.waitFor((s) => s.phase === 'final', 'fin');
    assert.deepEqual(host.state.teams.map((t) => t.score), [2, 2, 2]);
    assert.equal(host.state.winners.length, 3);

    // Confidentialité : la vérité n'apparaît jamais avant le vote, et jamais étiquetée avant sa révélation.
    const questions = game.order.map((q) => q.answer);
    for (const state of allStates(host, ...players.map((p) => p.client))) {
      if (['question', 'writing'].includes(state.phase)) {
        for (const answer of questions) assert.ok(!JSON.stringify(state).includes(answer), `fuite en phase ${state.phase}`);
      }
      for (const option of state.options ?? []) {
        if (!option.revealed) assert.deepEqual(Object.keys(option).sort(), ['id', 'revealed', 'text']);
      }
    }

    // Rejouer
    assert.equal((await host.emit('host:replay')).ok, true);
    await host.waitFor((s) => s.phase === 'question' && s.question.index === 1, 'nouvelle partie');
    assert.deepEqual(host.state.teams.map((t) => t.score), [0, 0, 0]);
  });
});

describe('équipes, tchat et validation', () => {
  async function teamsRoom() {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'teams', totalQuestions: 1 });
    track(host);
    const a1 = await join(code, 'A1');
    const a2 = await join(code, 'A2');
    const b1 = await join(code, 'B1');
    const b2 = await join(code, 'B2');
    const c = await join(code, 'C');
    await host.waitFor((s) => s.players.length === 5, '5 joueurs');
    assert.equal((await a1.client.emit('team:create')).ok, true);
    const teamA = (await a1.client.waitFor((s) => s.me.teamId, 'équipe A')).me.teamId;
    assert.equal((await a2.client.emit('team:join', { teamId: teamA })).ok, true);
    assert.equal((await b1.client.emit('team:create')).ok, true);
    const teamB = (await b1.client.waitFor((s) => s.me.teamId, 'équipe B')).me.teamId;
    assert.equal((await b2.client.emit('team:join', { teamId: teamB })).ok, true);
    assert.equal((await c.client.emit('team:create')).ok, true);
    await host.waitFor((s) => s.canLock, 'verrouillable');
    assert.equal((await host.emit('host:lockTeams')).ok, true);
    await host.waitFor((s) => s.phase === 'naming', 'nommage');
    return { host, code, a1, a2, b1, b2, c, teamA, teamB };
  }

  async function nameTeams({ host, a1, a2, b1, b2 }) {
    for (const [pair, name] of [[[a1, a2], 'Les Lions'], [[b1, b2], 'Les Ours']]) {
      assert.equal((await pair[0].client.emit('team:propose', { value: name })).ok, true);
      for (const p of pair) assert.equal((await p.client.emit('team:validate')).ok, true);
    }
    await host.waitFor((s) => s.canStart, 'prêt à démarrer');
  }

  test('le nom d’équipe est voté dans le tchat, puis la partie démarre', async () => {
    const room = await teamsRoom();
    const { host, a1, a2, b1, b2 } = room;
    await host.waitFor((s) => s.teamsNamed.named === 1, 'seule l’équipe solo est nommée');
    assert.equal(host.state.canStart, false);
    assert.equal((await a1.client.emit('team:chat', { text: 'On s’appelle comment ?' })).ok, true);
    await a2.client.waitFor((s) => s.team.chat.some((m) => m.text === 'On s’appelle comment ?'), 'message reçu');
    await nameTeams(room);
    assert.equal(host.state.teams.filter((t) => t.name).length, 3);
    assert.equal((await host.emit('host:start')).ok, true);
    await host.waitFor((s) => s.phase === 'question', 'question');
    assert.ok(b1 && b2);
  });

  test('le tchat d’une équipe n’arrive ni à l’écran ni aux autres équipes', async () => {
    const room = await teamsRoom();
    const { host, a1, b1, c } = room;
    await nameTeams(room);
    await host.emit('host:start');
    await host.waitFor((s) => s.phase === 'question', 'question');
    const secret = 'SECRET-TCHAT-42';
    assert.equal((await a1.client.emit('team:chat', { text: secret })).ok, true);
    assert.equal((await a1.client.emit('team:propose', { value: 'SECRET-PROPOSITION' })).error, 'wrong_phase');
    await a1.client.waitFor((s) => s.team.chat.some((m) => m.text === secret), 'message');
    for (const p of [room.a2, a1]) await p.client.emit('player:ready');
    for (const p of [b1, room.b2, c]) await p.client.emit('player:ready');
    await host.waitFor((s) => s.phase === 'writing', 'écriture');
    await a1.client.emit('team:propose', { value: 'SECRET-PROPOSITION' });
    await a1.client.waitFor((s) => s.team.proposal, 'proposition');
    await new Promise((resolve) => setTimeout(resolve, 80));
    for (const outsider of [host, b1.client, room.b2.client, c.client]) {
      for (const state of outsider.states) {
        assert.ok(!JSON.stringify(state).includes('SECRET-TCHAT-42'), 'tchat divulgué');
        assert.ok(!JSON.stringify(state).includes('SECRET-PROPOSITION'), 'proposition divulguée');
      }
    }
  });

  test('un membre qui se déconnecte pendant l’unanimité ne bloque pas l’équipe', async () => {
    const room = await teamsRoom();
    const { host, a1, a2 } = room;
    await nameTeams(room);
    await host.emit('host:start');
    await host.waitFor((s) => s.phase === 'question', 'question');
    for (const p of [room.a1, room.a2, room.b1, room.b2, room.c]) await p.client.emit('player:ready');
    await host.waitFor((s) => s.phase === 'writing', 'écriture');
    await a1.client.emit('team:propose', { value: 'Un renard' });
    await a1.client.emit('team:validate');
    assert.equal(host.state.teams.find((t) => t.name === 'Les Lions').progress.locked, false);
    a2.client.close();
    await host.waitFor((s) => s.teams.find((t) => t.name === 'Les Lions').progress.locked, 'équipe verrouillée');
  });

  test('reconnexion en pleine phase : équipe, proposition et validations restaurées', async () => {
    const room = await teamsRoom();
    const { host, code, a1, a2 } = room;
    await nameTeams(room);
    await host.emit('host:start');
    for (const p of [room.a1, room.a2, room.b1, room.b2, room.c]) await p.client.emit('player:ready');
    await host.waitFor((s) => s.phase === 'writing', 'écriture');
    await a1.client.emit('team:chat', { text: 'avant coupure' });
    await a1.client.emit('team:propose', { value: 'Un hibou' });
    await a1.client.emit('team:validate');

    a2.client.close();
    await host.waitFor((s) => s.players.find((p) => p.id === a2.playerId).connected === false, 'déconnexion vue');
    const back = track(await new Client(server.url).open());
    const reply = await back.emit('player:resume', { code, token: a2.token });
    assert.equal(reply.ok, true);
    assert.equal(reply.playerId, a2.playerId);
    const state = await back.waitFor((s) => s.me && s.phase !== undefined, 'état restauré');
    assert.equal(state.phase, 'writing');
    assert.equal(state.team.id, room.teamA);
    assert.equal(state.team.proposal.value, 'Un hibou');
    assert.deepEqual(state.team.validations, [a1.playerId]);
    assert.ok(state.team.chat.some((m) => m.text === 'avant coupure'));
    await host.waitFor((s) => s.players.find((p) => p.id === a2.playerId).connected === true, 'reconnecté');
  });

  test('un jeton invalide ne permet pas de reprendre une place', async () => {
    const room = await teamsRoom();
    const intruder = track(await new Client(server.url).open());
    const reply = await intruder.emit('player:resume', { code: room.code, token: 'faux-jeton' });
    assert.deepEqual(reply, { ok: false, error: 'unknown_player' });
    const hostIntruder = track(await new Client(server.url).open());
    assert.equal((await hostIntruder.emit('host:resume', { code: room.code, token: 'faux' })).ok, false);
  });

  test('l’hôte peut reprendre son salon avec son jeton', async () => {
    const room = await teamsRoom();
    const again = track(await new Client(server.url).open());
    const reply = await again.emit('host:resume', { code: room.code, token: room.token ?? server.rooms.get(room.code).hostToken });
    assert.equal(reply.ok, true);
    const state = await again.waitFor((s) => s.role === 'host', 'vue hôte');
    assert.equal(state.phase, 'naming');
  });
});

describe('délai accordé aux autres équipes (horloge simulée)', () => {
  test('le délai expire côté serveur sans action des joueurs', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base', totalQuestions: 1, graceSeconds: 20 });
    track(host);
    const players = [await join(code, 'Ann'), await join(code, 'Bob'), await join(code, 'Cid')];
    await host.waitFor((s) => s.players.length === 3, 'joueurs');
    await host.emit('host:start');
    for (const p of players) await p.client.emit('player:ready');
    await host.waitFor((s) => s.phase === 'writing', 'écriture');
    await players[0].client.emit('team:propose', { value: 'Un chien' });
    await host.waitFor((s) => s.deadlineIn === 20_000, 'délai annoncé');
    server.clock.advance(20_000);
    await host.waitFor((s) => s.phase === 'voting', 'vote automatique après le délai');
    assert.equal(host.state.options.length, 2);
  });
});

describe('salon : exclusion, fin et photos', () => {
  test('exclure un joueur le prévient et libère son pseudo', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base' });
    track(host);
    const ann = await join(code, 'Ann');
    await host.waitFor((s) => s.players.length === 1, 'joueur');
    assert.equal((await host.emit('host:kick', { playerId: ann.playerId })).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(ann.client.events.some((e) => e.name === 'ended' && e.payload.reason === 'kicked'));
    assert.equal((await ann.client.emit('player:photo', { photo: null })).error, 'not_authorized');
    const again = await join(code, 'Ann');
    assert.ok(again.playerId);
  });

  test('terminer le salon prévient tout le monde et supprime les données', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base' });
    track(host);
    const ann = await join(code, 'Ann');
    await ann.client.emit('player:photo', { photo: 'data:image/jpeg;base64,/9j/AAAA' });
    assert.equal((await host.emit('host:end')).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(ann.client.events.some((e) => e.name === 'ended'));
    assert.equal(server.rooms.has(code), false);
    const res = await fetch(`${server.url}/photos/${code}/${ann.playerId}.jpg`);
    assert.equal(res.status, 404);
  });

  test('la photo est servie en JPEG depuis la mémoire, uniquement pour un joueur existant', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base' });
    track(host);
    const ann = await join(code, 'Ann');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const photo = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    assert.equal((await ann.client.emit('player:photo', { photo })).ok, true);
    const res = await fetch(`${server.url}/photos/${code}/${ann.playerId}.jpg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    assert.equal((await fetch(`${server.url}/photos/${code}/p99.jpg`)).status, 404);
    assert.equal((await fetch(`${server.url}/photos/ZZZZ/${ann.playerId}.jpg`)).status, 404);
    assert.equal((await ann.client.emit('player:photo', { photo: 'data:image/png;base64,AAAA' })).error, 'invalid_photo');
  });

  test('un salon plein ou commencé refuse les nouveaux joueurs', async () => {
    await setup();
    const { host, code } = await createRoom(server, { mode: 'base' });
    track(host);
    for (const name of ['Ann', 'Bob', 'Cid']) await join(code, name);
    await host.waitFor((s) => s.players.length === 3, 'joueurs');
    await host.emit('host:start');
    const late = track(await new Client(server.url).open());
    assert.equal((await late.emit('player:join', { code, name: 'Retard' })).error, 'game_started');
  });
});

describe('routes HTTP', () => {
  test('configuration, règles, QR code, santé et pages', async () => {
    await setup({ env: { HOST_IP: '192.168.1.20', HOST_PORT: '3999' }, version: '9.9.9' });
    const config = await (await fetch(`${server.url}/api/config`)).json();
    assert.deepEqual(config, { protocol: 1, version: '9.9.9', publicUrl: 'http://192.168.1.20:3999' });

    const rules = await fetch(`${server.url}/api/rules`);
    assert.match(rules.headers.get('content-type'), /markdown/);
    assert.match(await rules.text(), /## A/);

    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
    assert.equal((await fetch(`${server.url}/api/qr/ZZZZ.svg`)).status, 404);

    const { host, code } = await createRoom(server);
    track(host);
    const qr = await fetch(`${server.url}/api/qr/${code}.svg`);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), /svg/);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${server.url}/api/qr/${code.toLowerCase()}.svg`)).status, 200);
  });

  test('les fichiers de la banque de questions ne sont pas exposés', async () => {
    await setup();
    for (const path of ['/game/questions.json', '/game/engine.js', '/server/app.js', '/package.json', '/.env', '/tests/helpers.js']) {
      assert.equal((await fetch(`${server.url}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${server.url}/shared/protocol.js`)).status, 200);
  });

  test('en-têtes de sécurité', async () => {
    await setup();
    const res = await fetch(`${server.url}/healthz`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('limitation de débit', () => {
  test('un client qui spamme est limité', async () => {
    await setup();
    const client = track(await new Client(server.url).open());
    const replies = await Promise.all(Array.from({ length: 80 }, () => client.emit('host:start')));
    assert.ok(replies.some((r) => r.error === 'rate_limited'));
  });
});


describe('thèmes des questions', () => {
  const BANK = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `i${i}`, text: `Insolite ${i} ?`, answer: `ri${i}`, tags: ['Insolite'] })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `n${i}`, text: `Noël ${i} ?`, answer: `rn${i}`, tags: ['Noël', 'Insolite'] })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, text: `Classique ${i} ?`, answer: `rc${i}`, tags: ['Classique'] })),
  ];

  test('le salon expose les thèmes et leur effectif ; « Classique » est décoché par défaut', async () => {
    await setup({ questions: BANK });
    const { host } = await createRoom(server, { mode: 'base', totalQuestions: 3 });
    track(host);
    const state = await host.waitFor((s) => s.phase === 'lobby', 'salon');
    assert.deepEqual(state.themes, [
      { name: 'Classique', count: 5 },
      { name: 'Insolite', count: 6 },
      { name: 'Noël', count: 2 },
    ]);
    assert.deepEqual(state.selectedThemes, ['Insolite', 'Noël']);
    assert.deepEqual(state.pool, { available: 6, needed: 3, ok: true });
  });

  test('changer les thèmes met à jour le décompte ; thème inconnu refusé', async () => {
    await setup({ questions: BANK });
    const { host } = await createRoom(server, { mode: 'base', totalQuestions: 3 });
    track(host);
    assert.deepEqual(await host.emit('host:configure', { config: { themes: ['Noël'] } }), { ok: true });
    const state = await host.waitFor((s) => s.pool.available === 2, 'thème Noël seul');
    assert.equal(state.canStart, false);
    assert.equal((await host.emit('host:configure', { config: { themes: ['Nope'] } })).error, 'invalid_config');
  });

  test('pas assez de questions : la partie est refusée, puis acceptée avec d’autres thèmes', async () => {
    await setup({ questions: BANK });
    const { host, code } = await createRoom(server, { mode: 'base', totalQuestions: 3, themes: ['Noël'] });
    track(host);
    for (const name of ['Ann', 'Bob', 'Cid']) await join(code, name);
    await host.waitFor((s) => s.players.length === 3, '3 joueurs');
    const refused = await host.emit('host:start');
    assert.equal(refused.error, 'not_enough_questions');
    assert.equal(refused.available, 2);
    assert.equal(refused.needed, 3);
    assert.equal(host.state.phase, 'lobby');
    await host.emit('host:configure', { config: { themes: ['Noël', 'Insolite'] } });
    assert.deepEqual(await host.emit('host:start'), { ok: true });
    await host.waitFor((s) => s.phase === 'question', 'question');
  });
});