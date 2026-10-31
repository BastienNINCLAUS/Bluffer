import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

// Une erreur de syntaxe dans un script du navigateur fige toute la page sans que les tests du serveur ne la voient.
test('les scripts du navigateur (public/) sont syntaxiquement valides', () => {
  const files = [...collect(join(root, 'public')), ...collect(join(root, 'shared'))];
  assert.ok(files.length > 0);
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative(root, file)} : ${result.stderr}`);
  }
});
