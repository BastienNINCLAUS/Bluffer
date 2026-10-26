import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, QUESTIONS, expectOk, addPlayers, nameTeam, everyoneReady } from './helpers.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'scenarios');

// Une partie scénarisée est rejouée avec le vrai moteur ; les équipes sont désignées par leur nom
// (le pseudo pour une équipe d'un seul joueur). Format : voir tests/scenarios/*.json.
function playScenario(scenario) {
  const game = newGame({ mode: scenario.mode, ...scenario.config });
  const idsByTeam = new Map();
  const teamIdOf = (name) => game.players.get(idsByTeam.get(name)[0]).teamId;

  if (scenario.mode === 'base') {
    for (const name of scenario.players) idsByTeam.set(name, addPlayers(game, [name]));
  } else {
    for (const [teamName, members] of Object.entries(scenario.teams)) {
      const ids = addPlayers(game, members);
      if (ids.length === 1) assert.equal(teamName, members[0], 'équipe solo : le nom est le pseudo');
      idsByTeam.set(teamName, ids);
      expectOk(game.createTeam(ids[0]));
      ids.slice(1).forEach((id) => expectOk(game.joinTeam(id, game.players.get(ids[0]).teamId)));
    }
    expectOk(game.lockTeams());
    for (const [teamName, ids] of idsByTeam) if (ids.length > 1) nameTeam(game, ids, teamName);
  }
  expectOk(game.start());

  const closePhase = (phase) => {
    if (game.phase !== phase) return;
    if (game.deadline !== null) {
      game.clock.advance(game.config.graceSeconds * 1000 + 1);
      assert.equal(game.tick(), true, `le délai doit clore la phase ${phase}`);
    } else {
      expectOk(game.hostAdvance());
    }
    assert.notEqual(game.phase, phase);
  };
  const scores = () => Object.fromEntries([...idsByTeam.keys()].map((n) => [n, game.teams.get(teamIdOf(n)).score]));
  const gains = () => Object.fromEntries([...idsByTeam.keys()].map((n) => [n, game.teams.get(teamIdOf(n)).gain]));

  scenario.rounds.forEach((round, index) => {
    const label = `${scenario.name}, question ${index + 1}`;
    assert.equal(game.phase, 'question', label);
    everyoneReady(game);
    assert.equal(game.phase, 'writing', label);

    for (const [name, text] of Object.entries(round.answers)) {
      if (text === null) continue;
      const ids = idsByTeam.get(name);
      expectOk(game.propose(ids[0], text));
      // une équipe d'un seul joueur valide dès la proposition
      ids.forEach((id) => game.validate(id));
    }
    closePhase('writing');
    assert.equal(game.phase, 'voting', label);

    for (const [name, target] of Object.entries(round.votes)) {
      if (target === null) continue;
      const option = game.options.find((o) => (target === 'truth' ? o.kind === 'truth' : o.teamId === teamIdOf(target)));
      assert.ok(option, `${label} : pas de réponse pour « ${target} »`);
      const ids = idsByTeam.get(name);
      expectOk(game.propose(ids[0], option.id));
      ids.forEach((id) => game.validate(id));
    }
    closePhase('voting');
    assert.equal(game.phase, 'reveal', label);

    const lastRevealed = game.options.find((o) => o.id === game.revealOrder.at(-1));
    assert.equal(lastRevealed.kind, 'truth', `${label} : la vraie réponse est révélée en dernier`);
    while (game.phase === 'reveal') everyoneReady(game);
    assert.equal(game.phase, 'scoreboard', label);

    assert.deepEqual(gains(), round.gains, `${label} : gains`);
    assert.deepEqual(scores(), round.scores, `${label} : scores`);
    everyoneReady(game);
  });

  assert.equal(game.phase, 'final', scenario.name);
  const winners = game.teamList().filter((t) => scenario.winners.includes(t.name)).map((t) => t.id);
  assert.deepEqual(
    game.teamList().filter((t) => t.score === Math.max(...game.teamList().map((x) => x.score))).map((t) => t.id).sort(),
    winners.sort(),
    `${scenario.name} : gagnants`,
  );

  if (scenario.replay) {
    const before = game.teamList().map((t) => [t.id, t.name, t.color]);
    expectOk(game.replay());
    assert.deepEqual(game.teamList().map((t) => [t.id, t.name, t.color]), before, 'rejouer conserve équipes, noms et couleurs');
    assert.ok(game.teamList().every((t) => t.score === 0), 'rejouer remet les scores à zéro');
    assert.equal(game.phase, 'question');
  }
}

describe('parties scénarisées', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  test('au moins trois scénarios sont fournis', () => {
    assert.ok(files.length >= 3);
    assert.ok(QUESTIONS.length > 0);
  });

  for (const file of files) {
    const scenario = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    test(`${file} : ${scenario.name}`, () => playScenario(scenario));
  }
});
