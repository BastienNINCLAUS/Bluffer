import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.js';
import { loadQuestions } from '../../game/questions.js';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const questions = loadQuestions(join(root, 'game', 'questions.json'));
const rulesText = readFileSync(join(root, 'game', 'rules.md'), 'utf8');
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

let app;
let baseUrl;
let browser;
const errors = [];

async function setup() {
  app = createApp({ questions, rulesText, env: {} });
  const port = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}

async function teardown() {
  await browser?.close();
  await app?.close();
}

async function newPage(viewport, label) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  page.label = label;
  return page;
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function makeJpeg(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 0, 60, 40);
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath();
    ctx.arc(30, 20, 12, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

const button = (page, name, exact = false) => page.getByRole('button', { name, exact });

async function advanceHost(host, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await host.evaluate(() => document.activeElement?.blur());
    await host.keyboard.press('Space');
    await host.waitForTimeout(120);
  }
}

async function fullGame() {
  const host = await newPage({ width: 1600, height: 900 }, 'host');
  await host.goto(`${baseUrl}/host`);
  await host.locator('.code').waitFor();
  const code = (await host.locator('.code').textContent()).trim();
  assert.match(code, /^[A-Z]{4}$/);
  assert.ok(await host.locator('img.qr').isVisible(), 'QR code affiché');
  assert.ok(await host.locator('.rules-card').isVisible(), 'règles affichées à la création de la partie');
  assert.ok(await host.getByText('Un doute sur les règles').isHidden(), 'bandeau de rappel inutile dans le salon');

  // Réglages : 1 seule question.
  await host.locator('.settings input[type=number]').first().fill('1');
  await host.keyboard.press('Tab');
  await host.waitForFunction(() => document.querySelector('.settings input[type=number]').value === '1');

  const names = ['A1', 'A2', 'B1', 'B2', 'C'];
  const phones = {};
  for (const name of names) phones[name] = await newPage({ width: 390, height: 780 }, name);
  const jpeg = await makeJpeg(phones.A1);

  for (const name of names) {
    const phone = phones[name];
    await phone.goto(`${baseUrl}/play?code=${code}`);
    await phone.locator('#pseudo-input').fill(name);
    if (name !== 'C') await phone.locator('#photo-input').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await button(phone, 'Rejoindre', true).click();
    await phone.locator('.bar-name').waitFor();
    assert.ok(await phone.getByText('Besoin des règles').isVisible(), 'rappel des règles sur le téléphone');
  }
  await host.waitForFunction(() => document.querySelectorAll('.member').length >= 5 || document.querySelectorAll('.loose .member').length >= 5);

  // Constitution des équipes.
  await button(phones.A1, 'Créer une équipe').click();
  await phones.A2.locator('.progress-list').getByRole('button', { name: 'Rejoindre' }).first().click();
  await button(phones.B1, 'Créer une équipe').click();
  await phones.B2.locator('.progress-list').getByRole('button', { name: 'Rejoindre' }).nth(1).click();
  await button(phones.C, 'Créer une équipe').click();
  await shot(phones.A2, '01-phone-lobby');
  await shot(host, '02-host-lobby');
  await host.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Verrouiller') && !b.disabled));

  // Règles consultables à tout moment depuis le téléphone.
  await button(phones.A1, 'Règles').click();
  await phones.A1.getByRole('dialog').waitFor();
  assert.ok(await phones.A1.getByText('+2 points').first().isVisible());
  assert.ok(await phones.A1.getByText('30 secondes').first().isVisible(), 'délai réglé injecté');
  await shot(phones.A1, '03-phone-rules');
  await button(phones.A1, 'Fermer').click();

  await button(host, 'Verrouiller les équipes').click();

  // Noms d'équipe votés dans le tchat.
  await phones.A1.locator('#chat-input').fill('Les Lions');
  await phones.A1.locator('#chat-input').press('Enter');
  await phones.A2.locator('.msg-text', { hasText: 'Les Lions' }).waitFor();
  assert.equal(await phones.B1.getByText('Les Lions').count(), 0, 'le tchat ne fuit pas vers l’autre équipe');
  assert.equal(await host.getByText('Lions').count(), 0, 'le tchat ne fuit pas vers l’écran');
  await phones.A2.locator('.msg', { hasText: 'Les Lions' }).getByRole('button', { name: 'Proposer', exact: true }).click();
  await phones.A1.getByText('Proposition de l’équipe').waitFor();
  await phones.A1.getByRole('button', { name: 'Valider', exact: true }).click();
  await shot(phones.A1, '04-phone-naming');
  assert.equal(await host.locator('.badge.ok').count(), 1, 'seule l’équipe solo a un nom avant l’unanimité');
  await phones.A2.getByRole('button', { name: 'Valider', exact: true }).click();

  await phones.B1.locator('#name-input').fill('Les Ours');
  await phones.B1.getByRole('button', { name: 'Proposer ce nom' }).click();
  await phones.B1.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.B2.getByRole('button', { name: 'Valider', exact: true }).click();

  await host.getByText('3/3 équipes prêtes').waitFor();
  await shot(host, '05-host-naming');
  await button(host, 'Lancer la partie').click();

  // Question.
  await host.locator('.question-big h1').waitFor();
  const questionText = (await host.locator('.question-big h1').textContent()).trim();
  const truth = questions.find((q) => q.text === questionText).answer;
  assert.ok(await host.getByText('Un doute sur les règles').isVisible(), 'rappel permanent des règles sur l’écran');
  for (const name of names) await phones[name].getByRole('button', { name: /Je suis prêt/ }).click();
  await shot(host, '06-host-question');

  // Écriture des fausses réponses.
  await phones.A1.locator('#answer-input').fill('Un hibou furieux');
  await phones.A1.getByRole('button', { name: 'Proposer', exact: true }).click();
  await phones.A1.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.A2.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.B1.locator('#answer-input').fill('Une montgolfière');
  await phones.B1.getByRole('button', { name: 'Proposer', exact: true }).click();
  await phones.B1.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.B2.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.A1.getByText('Réponse envoyée').waitFor();
  await shot(host, '07-host-writing');
  await shot(phones.A1, '08-phone-answer-sent');

  // Vérité refusée pour le joueur seul, puis fausse réponse.
  await phones.C.locator('#answer-input').fill(truth);
  await phones.C.getByRole('button', { name: 'Envoyer' }).click();
  await phones.C.getByText('Cette réponse est la vraie').waitFor();
  await phones.C.locator('#answer-input').fill('Un pigeon voyageur');
  await phones.C.getByRole('button', { name: 'Envoyer' }).click();

  // Vote.
  await host.locator('.big-options').waitFor();
  assert.equal(await host.locator('.big-option').count(), 4);
  await shot(host, '09-host-voting');
  await phones.A1.locator('.option').first().waitFor();
  await phones.A1.locator('.option', { hasText: 'Un hibou furieux' }).click();
  assert.equal(await phones.A1.locator('.option.own').count(), 1, 'sa propre réponse est signalée');
  await phones.A1.locator('.option', { hasText: truth }).click();
  await phones.A1.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.A2.getByRole('button', { name: 'Valider', exact: true }).click();
  await shot(phones.A1, '10-phone-voting');
  await phones.B1.locator('.option', { hasText: truth }).click();
  await phones.B1.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.B2.getByRole('button', { name: 'Valider', exact: true }).click();
  await phones.C.locator('.option', { hasText: 'Un hibou furieux' }).click();
  await phones.C.getByRole('button', { name: /Voter pour le n°/ }).click();

  // Révélation, une réponse à la fois, puis classement animé.
  await host.locator('.reveal-list-big').waitFor();
  await shot(host, '11-host-reveal-start');
  await advanceHost(host, 2);
  await shot(host, '12-host-reveal-partial');
  await advanceHost(host, 2);
  assert.equal(await host.locator('.reveal-card.truth').count(), 1);
  await shot(host, '13-host-reveal-end');
  await advanceHost(host, 1);
  await host.locator('.scoreboard').waitFor();
  await host.waitForTimeout(500);
  await shot(host, '14-host-scoreboard-start');
  await host.waitForTimeout(2500);
  await shot(host, '15-host-scoreboard-end');
  assert.equal(await host.locator('.sb-row').count(), 3);
  assert.match(await phones.A1.locator('.rank').textContent(), /1er/);
  await shot(phones.A1, '16-phone-scoreboard');

  // Résultat final : Les Lions (+2 +1 = 3) gagnent.
  await advanceHost(host, 1);
  await host.locator('.victory').waitFor();
  assert.match(await host.locator('.winner-name').textContent(), /Lions/);
  await shot(host, '17-host-final');
  assert.match(await phones.A1.locator('.rank').textContent(), /Victoire/);
  await shot(phones.C, '18-phone-final');

  assert.deepEqual(errors, []);
  for (const page of [host, ...Object.values(phones)]) await page.context().close();
}

async function reconnection() {
  const host = await newPage({ width: 1280, height: 720 }, 'host2');
  await host.goto(`${baseUrl}/host`);
  const code = (await host.locator('.code').textContent()).trim();
  const phone = await newPage({ width: 390, height: 780 }, 'phone2');
  await phone.goto(`${baseUrl}/play?code=${code}`);
  await phone.locator('#pseudo-input').fill('Zoé');
  await button(phone, 'Rejoindre', true).click();
  await phone.locator('.bar-name').waitFor();
  await phone.reload();
  await phone.locator('.bar-name').waitFor();
  assert.equal((await phone.locator('.bar-name').textContent()).trim(), 'Zoé');
  await host.reload();
  assert.equal((await host.locator('.code').textContent()).trim(), code, 'l’hôte reprend son salon après un rechargement');
  assert.deepEqual(errors, []);
  await host.context().close();
  await phone.context().close();
}

describe('bout en bout (navigateur réel)', () => {
  before(setup);
  after(teardown);
  test('parcours complet : écran hôte + 5 téléphones (2 équipes de 2 et un joueur seul)', { timeout: 90_000 }, fullGame);
  test('un téléphone qui recharge la page reprend sa place', { timeout: 30_000 }, reconnection);
});
