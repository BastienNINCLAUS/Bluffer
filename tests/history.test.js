import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileHistory } from '../server/history.js';
import { MemoryHistory } from '../game/history.js';
import { startServer, createRoom, joinPlayer } from './server-helpers.js';

const silent = { warn() {}, error() {} };
const dirs = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bluffer-history-'));
  dirs.push(dir);
  return join(dir, 'data', 'played.json');
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('MemoryHistory', () => {
  test('compte, remet à zéro et ignore les valeurs invalides au chargement', () => {
    const history = new MemoryHistory({ a: 2, b: 0, c: -1, d: 1.5, e: 'x' });
    assert.deepEqual(history.toJSON(), { a: 2 });
    history.record('a');
    history.record('z');
    assert.equal(history.count('a'), 3);
    assert.equal(history.count('z'), 1);
    assert.equal(history.count('absent'), 0);
    history.reset();
    assert.deepEqual(history.toJSON(), {});
  });
});

describe('FileHistory', () => {
  test('écrit le fichier (dossier créé) et le relit au redémarrage', () => {
    const file = tempFile();
    const history = new FileHistory(file, { delayMs: 10_000, log: silent });
    history.record('q1');
    history.record('q1');
    history.record('q2');
    assert.equal(existsSync(file), false, 'écriture différée');
    history.flush();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, counts: { q1: 2, q2: 1 } });
    assert.equal(existsSync(`${file}.tmp`), false);

    const reloaded = new FileHistory(file, { log: silent });
    assert.equal(reloaded.count('q1'), 2);
    assert.equal(reloaded.count('q2'), 1);
  });

  test('l’écriture différée a lieu toute seule', async () => {
    const file = tempFile();
    const history = new FileHistory(file, { delayMs: 20, log: silent });
    history.record('q1');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).counts.q1, 1);
  });

  test('la remise à zéro est aussi enregistrée', () => {
    const file = tempFile();
    const history = new FileHistory(file, { delayMs: 10_000, log: silent });
    history.record('q1');
    history.flush();
    history.reset();
    history.flush();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, {});
  });

  test('un fichier absent donne un historique vide, et le dossier est créé à la première écriture', () => {
    const file = tempFile();
    const history = new FileHistory(file, { delayMs: 10_000, log: silent });
    assert.equal(history.count('q1'), 0);
    history.record('q1');
    history.flush();
    assert.equal(existsSync(file), true);
  });

  test('un fichier corrompu est ignoré avec un avertissement', () => {
    const file = tempFile();
    const first = new FileHistory(file, { delayMs: 10_000, log: silent });
    first.record('q1');
    first.flush();
    writeFileSync(file, '{pas du json');
    const warnings = [];
    const history = new FileHistory(file, { log: { warn: (m) => warnings.push(m), error() {} } });
    assert.equal(history.count('q1'), 0);
    assert.equal(warnings.length, 1);
  });
});

describe('serveur : l’historique est partagé entre les salons et survit aux redémarrages', () => {
  const BANK = Array.from({ length: 6 }, (_, i) => ({ id: `q${i + 1}`, text: `Question ${i + 1} ?`, answer: `Vraie ${i + 1}` }));
  let servers = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
  });

  async function playRoom(server) {
    const { host, code } = await createRoom(server, { mode: 'base', totalQuestions: 3 });
    for (const name of ['Ann', 'Bob', 'Cid']) await joinPlayer(server, code, name);
    await host.waitFor((s) => s.players.length === 3, '3 joueurs');
    assert.equal((await host.emit('host:start')).ok, true);
    const state = await host.waitFor((s) => s.phase === 'question', 'question');
    const ids = server.rooms.get(code).game.order.map((q) => q.id);
    assert.equal(state.question.total, 3);
    await host.emit('host:end');
    host.close();
    return ids;
  }

  test('deux salons successifs ne se répètent pas, même après un redémarrage du serveur', async () => {
    const file = tempFile();
    let history = new FileHistory(file, { delayMs: 10_000, log: silent });
    let server = await startServer({ questions: BANK, history });
    servers.push(server);
    const firstGame = await playRoom(server);
    // Seule la première question est réellement posée : les deux autres restent « jamais jouées ».
    assert.equal(history.playedAmong(BANK), 1);
    await server.close();
    servers = [];

    history = new FileHistory(file, { log: silent });
    assert.equal(history.playedAmong(BANK), 1, 'historique relu après redémarrage');
    server = await startServer({ questions: BANK, history });
    servers.push(server);
    const secondGame = await playRoom(server);
    assert.ok(!secondGame.includes(firstGame[0]), 'la question déjà jouée est écartée du 2e salon');
  });

  test('l’hôte peut réinitialiser l’historique depuis le salon', async () => {
    const history = new MemoryHistory();
    history.record('q1');
    const server = await startServer({ questions: BANK, history });
    servers.push(server);
    const { host } = await createRoom(server, { mode: 'base', totalQuestions: 3 });
    const before = await host.waitFor((s) => s.phase === 'lobby', 'salon');
    assert.deepEqual(before.history, { played: 1, total: 6 });
    assert.deepEqual(await host.emit('host:resetHistory'), { ok: true });
    const after = await host.waitFor((s) => s.history.played === 0, 'historique vide');
    assert.equal(after.pool.fresh, 6);
    host.close();
  });
});
