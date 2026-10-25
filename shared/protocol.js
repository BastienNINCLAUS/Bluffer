// Contrat des échanges Socket.IO entre serveur, écran hôte et téléphones.
// Incrémenter PROTOCOL_VERSION à chaque changement incompatible.
export const PROTOCOL_VERSION = 1;

export const SERVER_EVENTS = Object.freeze({
  HELLO: 'hello',
  STATE: 'state',
  ENDED: 'ended',
});

// Type de chaque champ : 'string', 'number', 'boolean', 'object', 'string|number', 'string|null'.
// Un « ? » final rend le champ facultatif.
export const COMMANDS = Object.freeze({
  'host:create': { config: 'object?' },
  'host:resume': { code: 'string', token: 'string' },
  'host:configure': { config: 'object' },
  'host:randomize': { teamCount: 'number?' },
  'host:lockTeams': {},
  'host:unlockTeams': {},
  'host:start': {},
  'host:advance': {},
  'host:replay': {},
  'host:kick': { playerId: 'string' },
  'host:end': {},
  'player:join': { code: 'string', name: 'string' },
  'player:resume': { code: 'string', token: 'string' },
  'player:photo': { photo: 'string|null' },
  'player:ready': { ready: 'boolean?' },
  'team:create': {},
  'team:join': { teamId: 'string' },
  'team:color': { color: 'string' },
  'team:chat': { text: 'string' },
  'team:propose': { value: 'string|number' },
  'team:validate': {},
  'team:unvalidate': {},
});

const MAX_STRING = 200_000;

function matches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length <= MAX_STRING;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'string|number':
      return matches('string', value) || matches('number', value);
    case 'string|null':
      return value === null || matches('string', value);
    default:
      return false;
  }
}

// Renvoie { ok: true } ou { ok: false, error: 'invalid_payload', field }.
export function validatePayload(command, payload) {
  const schema = COMMANDS[command];
  if (!schema) return { ok: false, error: 'unknown_command' };
  const data = payload === undefined || payload === null ? {} : payload;
  if (typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'invalid_payload' };
  for (const [field, spec] of Object.entries(schema)) {
    const optional = spec.endsWith('?');
    const type = optional ? spec.slice(0, -1) : spec;
    const value = data[field];
    if (value === undefined) {
      if (optional) continue;
      return { ok: false, error: 'invalid_payload', field };
    }
    if (!matches(type, value)) return { ok: false, error: 'invalid_payload', field };
  }
  return { ok: true };
}
