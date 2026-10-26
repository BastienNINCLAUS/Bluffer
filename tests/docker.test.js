import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const probe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
const hasCompose = probe.status === 0;

function composeConfig(env) {
  const result = spawnSync('docker', ['compose', '--env-file', 'NUL', 'config', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOST_PORT: '', HOST_IP: '', ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).services.bluffer;
}

describe('Docker', () => {
  test('le Dockerfile écoute sur le port interne 3000, sans les dépendances de développement', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /^FROM node:20-alpine/m);
    assert.match(dockerfile, /ENV PORT=3000/);
    assert.match(dockerfile, /npm ci --omit=dev/);
  });

  test('le .dockerignore exclut .env et node_modules', () => {
    const ignore = readFileSync(join(root, '.dockerignore'), 'utf8').split(/\r?\n/);
    assert.ok(ignore.includes('.env'));
    assert.ok(ignore.includes('node_modules'));
  });

  test('docker compose config : HOST_PORT par défaut 3417 vers le port interne 3000', { skip: !hasCompose && 'docker compose indisponible' }, () => {
    const [port] = composeConfig({}).ports;
    assert.equal(String(port.published), '3417');
    assert.equal(port.target, 3000);
  });

  test('docker compose config : HOST_PORT et HOST_IP sont transmis', { skip: !hasCompose && 'docker compose indisponible' }, () => {
    const service = composeConfig({ HOST_PORT: '4242', HOST_IP: '192.168.1.20' });
    assert.equal(String(service.ports[0].published), '4242');
    assert.equal(service.ports[0].target, 3000);
    assert.equal(service.environment.HOST_PORT, '4242');
    assert.equal(service.environment.HOST_IP, '192.168.1.20');
    assert.equal(service.environment.PORT, '3000');
    assert.equal(service.volumes[0].target, '/data');
    assert.equal(service.volumes[0].type, 'volume');
  });

  test('le Dockerfile prépare un dossier /data accessible à l’utilisateur node', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /ENV DATA_DIR=\/data/);
    assert.match(dockerfile, /chown node:node \/data/);
  });
});
