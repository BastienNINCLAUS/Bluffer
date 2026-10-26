import { PHASES } from './engine.js';

// Partie de test : code fixe, 2 questions génériques (aucune question préparée n'est dévoilée) et des robots.
export const TEST_CODE = 'TEST';
export const TEST_QUESTIONS = Object.freeze([
  {
    id: 'test-ocean',
    text: 'Quel est le plus grand océan de la planète ?',
    answer: 'L’océan Pacifique',
    tags: ['Test'],
    bluffs: ['L’océan Atlantique', 'L’océan Indien', 'L’océan Arctique'],
  },
  {
    id: 'test-pieuvre',
    text: 'Combien de cœurs possède une pieuvre ?',
    answer: 'Trois',
    tags: ['Test'],
    bluffs: ['Deux', 'Quatre', 'Huit'],
  },
]);
export const TEST_BOT_NAMES = Object.freeze(['Bot Alice', 'Bot Bob', 'Bot Chloé']);

const DELAY_MIN_MS = 1500;
const DELAY_SPREAD_MS = 3500;
const SLOT_PHASES = [PHASES.NAMING, PHASES.WRITING, PHASES.VOTING];
const READY_PHASES = [PHASES.QUESTION, PHASES.REVEAL, PHASES.SCOREBOARD];

export function addBots(game, names = TEST_BOT_NAMES) {
  const ids = [];
  for (const name of names) {
    const result = game.addPlayer(name);
    if (result.ok) ids.push(result.player.id);
  }
  return ids;
}

// Les robots jouent comme des joueurs : prêt, proposition, validation, vote, avec un petit délai.
export function createBots(game, ids) {
  const bots = new Set(ids);
  let lastKey = null;
  let due = new Map();

  const phaseKey = () => `${game.phase}|${game.qIndex}|${game.revealCount}`;

  function proposalFor(id, team) {
    const index = [...bots].indexOf(id);
    if (game.phase === PHASES.NAMING) return `Équipe ${game.players.get(id).name}`;
    if (game.phase === PHASES.WRITING) {
      const bluffs = game.question.bluffs ?? [];
      return bluffs.length > 0 ? bluffs[index % bluffs.length] : `Je ne sais pas (${index + 1})`;
    }
    const candidates = game.options.filter((o) => !(o.kind === 'team' && o.teamId === team.id));
    return candidates.length > 0 ? candidates[Math.floor(game.rng() * candidates.length)].id : null;
  }

  function act(id) {
    const team = game.teamOf(id);
    if (!team) return false;
    if (READY_PHASES.includes(game.phase)) {
      return !game.ready.has(id) && game.setReady(id, true).ok;
    }
    if (!SLOT_PHASES.includes(game.phase) || team.locked) return false;
    if (team.proposal) return !team.validations.has(id) && game.validate(id).ok;
    const value = proposalFor(id, team);
    if (value === null || !game.propose(id, value).ok) return false;
    game.validate(id);
    return true;
  }

  // Renvoie true si l'état du jeu a changé.
  function step() {
    for (const id of bots) if (!game.players.has(id)) bots.delete(id);
    let changed = false;

    if (game.phase === PHASES.LOBBY && game.config.mode === 'teams') {
      for (const id of bots) {
        if (game.players.get(id).teamId === null && game.createTeam(id).ok) changed = true;
      }
    }

    const key = phaseKey();
    const stamp = game.now();
    if (key !== lastKey) {
      lastKey = key;
      due = new Map([...bots].map((id) => [id, stamp + DELAY_MIN_MS + game.rng() * DELAY_SPREAD_MS]));
    }
    for (const id of bots) {
      if (phaseKey() !== key) break;
      if ((due.get(id) ?? 0) > stamp) continue;
      if (act(id)) changed = true;
    }
    return changed;
  }

  return { ids: bots, step };
}
