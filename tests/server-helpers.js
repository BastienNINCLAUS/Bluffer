import { io as connect } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { makeClock, seededRng, QUESTIONS } from './helpers.js';

export async function startServer(options = {}) {
  const clock = options.clock ?? makeClock();
  const controller = createApp({
    questions: QUESTIONS,
    rulesText: '# Règles\n\n## A\n- un **point**\n',
    env: {},
    now: clock.now,
    rng: seededRng(3),
    tickMs: 15,
    ...options,
  });
  const port = await controller.listen(0, '127.0.0.1');
  return { ...controller, clock, port, url: `http://127.0.0.1:${port}` };
}

export class Client {
  constructor(url, { protocol = PROTOCOL_VERSION } = {}) {
    this.states = [];
    this.events = [];
    this.waiters = new Set();
    this.socket = connect(url, {
      auth: { protocol },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    this.socket.on('state', (view) => {
      this.states.push(view);
      for (const waiter of [...this.waiters]) waiter();
    });
    this.socket.on('ended', (payload) => this.events.push({ name: 'ended', payload }));
    this.socket.on('hello', (payload) => this.events.push({ name: 'hello', payload }));
  }

  get state() {
    return this.states.at(-1);
  }

  open() {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) return resolve(this);
      this.socket.once('connect', () => resolve(this));
      this.socket.once('connect_error', reject);
      return undefined;
    });
  }

  emit(event, payload = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Pas de réponse à ${event}`)), 2000);
      this.socket.emit(event, payload, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  // Attend qu'un état reçu satisfasse le prédicat.
  waitFor(predicate, label = 'état attendu', timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.state && predicate(this.state)) {
          this.waiters.delete(check);
          clearTimeout(timer);
          resolve(this.state);
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Délai dépassé : ${label} (dernier état : ${JSON.stringify(this.state)?.slice(0, 400)})`));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  close() {
    this.socket.close();
  }
}

export async function openClient(url) {
  return new Client(url).open();
}

// Crée un salon et renvoie l'hôte avec son code.
export async function createRoom(server, config = {}) {
  const host = await openClient(server.url);
  const result = await host.emit('host:create', { config });
  if (!result.ok) throw new Error(`host:create a échoué : ${JSON.stringify(result)}`);
  return { host, code: result.code, token: result.token };
}

export async function joinPlayer(server, code, name) {
  const client = await openClient(server.url);
  const result = await client.emit('player:join', { code, name });
  if (!result.ok) throw new Error(`player:join a échoué : ${JSON.stringify(result)}`);
  return { client, playerId: result.playerId, token: result.token };
}

export const gameOf = (server, code) => server.rooms.get(code).game;
