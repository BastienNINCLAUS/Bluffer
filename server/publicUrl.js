import os from 'node:os';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export const DEFAULT_HOST_PORT = 3417;

export function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  const value = String(hostHeader);
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

export function lanAddress(interfaces = os.networkInterfaces()) {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

// URL que les téléphones doivent utiliser : toujours le port PUBLIÉ sur le PC, jamais le port interne.
export function resolvePublicUrl({ env = {}, requestHost = '', lan = null } = {}) {
  if (env.PUBLIC_URL) return String(env.PUBLIC_URL).replace(/\/+$/, '');
  if (env.HOST_IP) return `http://${env.HOST_IP}:${env.HOST_PORT || DEFAULT_HOST_PORT}`;
  const hostname = hostnameOf(requestHost);
  if (hostname && !LOCAL_HOSTS.has(hostname)) return `http://${requestHost}`;
  if (lan) {
    const port = String(requestHost).includes(':') ? String(requestHost).split(':').pop() : '80';
    return `http://${lan}:${port}`;
  }
  return `http://${requestHost || `localhost:${DEFAULT_HOST_PORT}`}`;
}
