import { PROTOCOL_VERSION } from '../../shared/protocol.js';

// Connexion Socket.IO avec reprise automatique ; `io` vient de /socket.io/socket.io.js.
export function createConnection({ onState, onEnded, onStatus, onProtocolMismatch, onConnect }) {
  const socket = window.io({ auth: { protocol: PROTOCOL_VERSION } });
  socket.on('state', onState);
  socket.on('ended', onEnded);
  socket.on('connect', () => {
    onStatus('connected');
    onConnect();
  });
  socket.on('disconnect', () => onStatus('disconnected'));
  socket.on('connect_error', (error) => {
    if (error && error.message === 'protocol_mismatch') onProtocolMismatch();
    else onStatus('disconnected');
  });
  const emit = (event, payload = {}) =>
    new Promise((resolve) => {
      socket.timeout(5000).emit(event, payload, (error, result) => {
        resolve(error ? { ok: false, error: 'timeout' } : result);
      });
    });
  return { socket, emit };
}

export function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function saveJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée) : la reconnexion automatique sera simplement désactivée
  }
}
