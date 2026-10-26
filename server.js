import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.js';
import { loadQuestionBank } from './game/questions.js';
import { resolvePublicUrl, lanAddress, DEFAULT_HOST_PORT } from './server/publicUrl.js';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const port = Number(process.env.PORT) || 3000;

const questions = loadQuestionBank(join(root, 'game'));
const rulesText = readFileSync(join(root, 'game', 'rules.md'), 'utf8');

const { listen } = createApp({ questions, rulesText, version: pkg.version });
await listen(port);

const publicUrl = resolvePublicUrl({
  env: process.env,
  requestHost: `localhost:${process.env.HOST_PORT || port}`,
  lan: lanAddress(),
});
console.log(`Bluffer ${pkg.version} démarré (port interne ${port}).`);
console.log(`Écran hôte :   ${publicUrl}/host`);
console.log(`Joueurs :      ${publicUrl}/play`);
if (!process.env.HOST_IP && !process.env.PUBLIC_URL) {
  console.log(
    `Astuce : définissez HOST_IP (et HOST_PORT, ${DEFAULT_HOST_PORT} par défaut) pour que le QR code pointe vers le bon port.`,
  );
}
