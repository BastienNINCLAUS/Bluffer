import express from 'express';
import { createServer } from 'node:http';
import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Game } from '../game/engine.js';
import { MemoryHistory } from '../game/history.js';
import { TEST_CODE, TEST_QUESTIONS, addBots, createBots } from '../game/testGame.js';
import { hostView, playerView } from '../game/views.js';
import { PROTOCOL_VERSION, SERVER_EVENTS, validatePayload } from '../shared/protocol.js';
import { resolvePublicUrl, lanAddress } from './publicUrl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RATE_LIMIT = { windowMs: 1000, max: 40 };

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createApp({
  questions,
  rulesText = '',
  env = process.env,
  now = Date.now,
  rng = Math.random,
  tickMs = 250,
  roomTtlMs = 6 * 60 * 60 * 1000,
  version = '0.0.0',
  history = new MemoryHistory(),
} = {}) {
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('Questions requises.');

  const app = express();
  const server = createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 512 * 1024, serveClient: true });
  const rooms = new Map();

  // ---------- HTTP ----------

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
    );
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

  const publicUrlFor = (req) =>
    resolvePublicUrl({ env, requestHost: req.headers.host, lan: lanAddress() });

  app.get('/api/config', (req, res) => {
    res.json({ protocol: PROTOCOL_VERSION, version, publicUrl: publicUrlFor(req) });
  });

  app.get('/api/rules', (req, res) => {
    res.type('text/markdown; charset=utf-8').send(rulesText);
  });

  app.get('/api/qr/:code.svg', async (req, res) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room) return res.status(404).end();
    const target = `${publicUrlFor(req)}/play?code=${room.code}`;
    const svg = await QRCode.toString(target, { type: 'svg', margin: 1 });
    return res.type('image/svg+xml').send(svg);
  });

  app.get('/photos/:code/:playerId.jpg', (req, res) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    const player = room?.game.players.get(req.params.playerId);
    if (!player || !player.photo) return res.status(404).end();
    const base64 = player.photo.slice(player.photo.indexOf(',') + 1);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.type('image/jpeg').send(Buffer.from(base64, 'base64'));
  });

  app.get('/host', (req, res) => res.sendFile(join(ROOT, 'public', 'host.html')));
  app.get('/play', (req, res) => res.sendFile(join(ROOT, 'public', 'player.html')));
  app.use('/shared', express.static(join(ROOT, 'shared')));
  // Repli anti-veille pour les pages servies en HTTP (voir public/lib/wakelock.js).
  app.use('/vendor/nosleep', express.static(join(ROOT, 'node_modules', 'nosleep.js', 'dist')));
  app.use(express.static(join(ROOT, 'public')));

  // ---------- salons ----------

  function newCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
      if (code !== TEST_CODE && !rooms.has(code)) return code;
    }
    throw new Error('Plus de code de salon disponible.');
  }

  function broadcast(room) {
    const hv = hostView(room.game);
    for (const socket of room.hostSockets) socket.emit(SERVER_EVENTS.STATE, hv);
    for (const [playerId, sockets] of room.playerSockets) {
      if (sockets.size === 0) continue;
      const view = playerView(room.game, playerId);
      for (const socket of sockets) socket.emit(SERVER_EVENTS.STATE, view);
    }
  }

  function closeRoom(room, reason) {
    for (const socket of room.hostSockets) socket.emit(SERVER_EVENTS.ENDED, { reason });
    for (const sockets of room.playerSockets.values()) {
      for (const socket of sockets) socket.emit(SERVER_EVENTS.ENDED, { reason });
    }
    rooms.delete(room.code);
  }

  function attachPlayer(room, socket, playerId) {
    if (!room.playerSockets.has(playerId)) room.playerSockets.set(playerId, new Set());
    room.playerSockets.get(playerId).add(socket);
    socket.data = { role: 'player', code: room.code, playerId };
    room.game.setConnected(playerId, true);
  }

  function attachHost(room, socket) {
    room.hostSockets.add(socket);
    socket.data = { role: 'host', code: room.code };
  }

  const tickTimer = setInterval(() => {
    const stamp = now();
    for (const room of [...rooms.values()]) {
      if (room.game.tick()) broadcast(room);
      if (room.bots?.step()) broadcast(room);
      const hasSockets = room.hostSockets.size > 0 || [...room.playerSockets.values()].some((s) => s.size > 0);
      if (!hasSockets && stamp - room.lastActivity > roomTtlMs) closeRoom(room, 'expired');
    }
  }, tickMs);
  tickTimer.unref();

  // ---------- Socket.IO ----------

  io.use((socket, next) => {
    if (socket.handshake.auth?.protocol !== PROTOCOL_VERSION) return next(new Error('protocol_mismatch'));
    return next();
  });

  io.on('connection', (socket) => {
    socket.data = { role: null };
    socket.emit(SERVER_EVENTS.HELLO, { protocol: PROTOCOL_VERSION, version });
    let windowStart = now();
    let count = 0;

    const roomOf = () => (socket.data.code ? rooms.get(socket.data.code) : undefined);

    // `auth` : 'host' | 'player' | 'none'. Le handler renvoie { ok, ... } ; la diffusion suit chaque succès.
    function on(command, auth, handler) {
      socket.on(command, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const stamp = now();
          if (stamp - windowStart > RATE_LIMIT.windowMs) {
            windowStart = stamp;
            count = 0;
          }
          count += 1;
          if (count > RATE_LIMIT.max) return reply({ ok: false, error: 'rate_limited' });

          const check = validatePayload(command, payload);
          if (!check.ok) return reply(check);
          const data = payload ?? {};

          let room = null;
          if (auth !== 'none') {
            room = roomOf();
            if (!room || socket.data.role !== auth) return reply({ ok: false, error: 'not_authorized' });
            room.lastActivity = stamp;
          }
          const result = handler({ room, data, game: room?.game, playerId: socket.data.playerId });
          const { room: attached, silent, ...publicResult } = result;
          reply(publicResult);
          const target = room ?? attached;
          if (result.ok && target && !silent) broadcast(target);
          return undefined;
        } catch (error) {
          console.error(`Erreur dans ${command}:`, error);
          return reply({ ok: false, error: 'server_error' });
        }
      });
    }

    on('host:create', 'none', ({ data }) => {
      const test = data.test === true;
      if (test) {
        const previous = rooms.get(TEST_CODE);
        if (previous) closeRoom(previous, 'replaced');
      }
      const code = test ? TEST_CODE : newCode();
      let game;
      try {
        game = test
          ? new Game({ code, questions: [...TEST_QUESTIONS], config: { ...(data.config ?? {}), totalQuestions: TEST_QUESTIONS.length }, now, rng, history: new MemoryHistory() })
          : new Game({ code, questions, config: { ...(data.config ?? {}) }, now, rng, history });
      } catch {
        return { ok: false, error: 'invalid_config' };
      }
      const room = {
        code,
        game,
        hostToken: randomUUID(),
        hostSockets: new Set(),
        playerSockets: new Map(),
        tokens: new Map(),
        lastActivity: now(),
        bots: null,
      };
      if (test) {
        game.test = true;
        room.bots = createBots(game, addBots(game));
        room.bots.step();
      }
      rooms.set(code, room);
      attachHost(room, socket);
      return { ok: true, code, token: room.hostToken, room };
    });

    on('host:resume', 'none', ({ data }) => {
      const room = rooms.get(data.code.toUpperCase().trim());
      if (!room || !safeEqual(room.hostToken, data.token)) return { ok: false, error: 'unknown_room' };
      attachHost(room, socket);
      return { ok: true, code: room.code, room };
    });

    on('host:configure', 'host', ({ game, data }) => game.configure(data.config));
    on('host:randomize', 'host', ({ game, data }) => game.randomize(data.teamCount));
    on('host:lockTeams', 'host', ({ game }) => game.lockTeams());
    on('host:unlockTeams', 'host', ({ game }) => game.unlockTeams());
    on('host:start', 'host', ({ game }) => game.start());
    on('host:advance', 'host', ({ game }) => game.hostAdvance());
    on('host:replay', 'host', ({ game }) => game.replay());
    on('host:resetHistory', 'host', ({ game }) => game.resetHistory());

    on('host:kick', 'host', ({ room, game, data }) => {
      const result = game.removePlayer(data.playerId);
      if (!result.ok) return result;
      for (const [token, playerId] of room.tokens) {
        if (playerId === data.playerId) room.tokens.delete(token);
      }
      const sockets = room.playerSockets.get(data.playerId) ?? new Set();
      for (const target of sockets) {
        target.emit(SERVER_EVENTS.ENDED, { reason: 'kicked' });
        target.data = { role: null };
      }
      room.playerSockets.delete(data.playerId);
      return result;
    });

    on('host:end', 'host', ({ room }) => {
      closeRoom(room, 'ended');
      return { ok: true, silent: true };
    });

    on('player:join', 'none', ({ data }) => {
      const room = rooms.get(data.code.toUpperCase().trim());
      if (!room) return { ok: false, error: 'unknown_room' };
      const result = room.game.addPlayer(data.name);
      if (!result.ok) return result;
      const token = randomUUID();
      room.tokens.set(token, result.player.id);
      attachPlayer(room, socket, result.player.id);
      room.lastActivity = now();
      return { ok: true, code: room.code, playerId: result.player.id, token, room };
    });

    on('player:resume', 'none', ({ data }) => {
      const room = rooms.get(data.code.toUpperCase().trim());
      const playerId = room && [...room.tokens].find(([token]) => safeEqual(token, data.token))?.[1];
      if (!room || !playerId || !room.game.players.has(playerId)) return { ok: false, error: 'unknown_player' };
      attachPlayer(room, socket, playerId);
      return { ok: true, code: room.code, playerId, room };
    });

    on('player:photo', 'player', ({ game, playerId, data }) => game.setPhoto(playerId, data.photo));
    on('player:ready', 'player', ({ game, playerId, data }) => game.setReady(playerId, data.ready ?? true));
    on('team:create', 'player', ({ game, playerId }) => stripTeam(game.createTeam(playerId)));
    on('team:join', 'player', ({ game, playerId, data }) => stripTeam(game.joinTeam(playerId, data.teamId)));
    on('team:color', 'player', ({ game, playerId, data }) => game.setTeamColor(playerId, data.color));
    on('team:chat', 'player', ({ game, playerId, data }) => game.chat(playerId, data.text));
    on('team:propose', 'player', ({ game, playerId, data }) => game.propose(playerId, data.value));
    on('team:validate', 'player', ({ game, playerId }) => game.validate(playerId));
    on('team:unvalidate', 'player', ({ game, playerId }) => game.unvalidate(playerId));

    socket.on('disconnect', () => {
      const room = roomOf();
      if (!room) return;
      if (socket.data.role === 'host') {
        room.hostSockets.delete(socket);
      } else if (socket.data.role === 'player') {
        const sockets = room.playerSockets.get(socket.data.playerId);
        sockets?.delete(socket);
        if (!sockets || sockets.size === 0) {
          room.game.setConnected(socket.data.playerId, false);
          broadcast(room);
        }
      }
    });
  });

  // Les objets d'équipe du moteur ne doivent pas être renvoyés tels quels (Set, historique de chat…).
  function stripTeam(result) {
    if (!result.ok) return result;
    return { ok: true };
  }

  async function listen(port = 0, host = '0.0.0.0') {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    return server.address().port;
  }

  async function close() {
    clearInterval(tickTimer);
    // io.close() ferme aussi le serveur HTTP : on coupe les connexions keep-alive pour ne pas attendre.
    const closing = new Promise((resolve) => io.close(resolve));
    server.closeAllConnections?.();
    await closing;
    history.flush?.();
  }

  return { app, server, io, rooms, history, listen, close };
}
