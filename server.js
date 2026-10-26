import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.js';
import { FileHistory } from './server/history.js';
import { loadQuestionBank } from './game/questions.js';
import { resolvePublicUrl, lanAddress, DEFAULT_HOST_PORT } from './server/publicUrl.js';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const port = Number(process.env.PORT) || 3000;

const questions = loadQuestionBank(join(root, 'game'));
const rulesText = readFileSync(join(root, 'game', 'rules.md'), 'utf8');
// Compteur de questions jouées, conservé d'une partie et d'un redémarrage à l'autre.
const dataDir = process.env.DATA_DIR || join(root, 'data');
const history = new FileHistory(join(dataDir, 'played.json'));

const { listen, close } = createApp({ questions, rulesText, version: pkg.version, history });
await listen(port);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
}

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
