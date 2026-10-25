import { PHASES, LIMITS } from './engine.js';
import { rankTeams } from '../shared/ranking.js';

const QUESTION_PHASES = [PHASES.QUESTION, PHASES.WRITING, PHASES.VOTING, PHASES.REVEAL, PHASES.SCOREBOARD];

function optionPoints(option) {
  return option.kind === 'team' ? 2 * option.voters.length : option.voters.length;
}

function publicOptions(game) {
  if (game.phase !== PHASES.VOTING && game.phase !== PHASES.REVEAL) return [];
  const revealed = new Set(game.revealOrder.slice(0, game.revealCount));
  return game.options.map((option) => {
    if (!revealed.has(option.id)) return { id: option.id, text: option.text, revealed: false };
    return {
      id: option.id,
      text: option.text,
      revealed: true,
      kind: option.kind,
      teamId: option.teamId,
      voters: [...option.voters],
      points: optionPoints(option),
    };
  });
}

function publicTeam(game, team, showGain) {
  const members = game.members(team);
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    memberIds: members.map((m) => m.id),
    score: team.score,
    prevScore: team.prevScore,
    gain: showGain ? team.gain : 0,
    progress: {
      locked: team.locked,
      hasProposal: team.proposal !== null,
      validated: members.filter((m) => team.validations.has(m.id)).length,
      size: members.length,
    },
  };
}

export function publicView(game) {
  const phase = game.phase;
  const showGain = phase === PHASES.SCOREBOARD || phase === PHASES.FINAL;
  const teams = game.teamList().map((t) => publicTeam(game, t, showGain));
  const ranking = rankTeams(teams, 'score');
  const prevRanking = rankTeams(teams, 'prevScore');
  const prevRankById = new Map(prevRanking.map((r) => [r.id, r.rank]));
  const { count, total } = game.readyCount();

  return {
    code: game.code,
    phase,
    config: { ...game.config },
    question: QUESTION_PHASES.includes(phase)
      ? { index: game.qIndex + 1, total: game.order.length, text: game.question.text }
      : null,
    options: publicOptions(game),
    revealCount: game.revealCount,
    revealTotal: game.revealOrder.length,
    deadlineIn: game.deadline === null ? null : Math.max(0, game.deadline - game.now()),
    ready: {
      active: game.readyPhase() && game.config.advance !== 'host',
      count,
      total,
    },
    teamsNamed: { named: game.teamsReady(), total: game.teams.size },
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      connected: p.connected,
      hasPhoto: p.photo !== null,
      photoVersion: p.photoVersion,
    })),
    teams,
    ranking: ranking.map((r) => ({ ...r, prevRank: prevRankById.get(r.id) })),
    winners: phase === PHASES.FINAL ? ranking.filter((r) => r.rank === 1).map((r) => r.id) : [],
    limits: { minTeams: LIMITS.minTeams, maxTeams: LIMITS.maxTeams, maxPlayers: LIMITS.maxPlayers },
  };
}

export function hostView(game) {
  const unassigned = [...game.players.values()].filter((p) => p.connected && !p.teamId).length;
  const named = game.teamsReady();
  return {
    ...publicView(game),
    role: 'host',
    unassigned,
    canLock:
      game.phase === PHASES.LOBBY &&
      game.config.mode === 'teams' &&
      unassigned === 0 &&
      game.teams.size >= LIMITS.minTeams,
    canStart:
      game.config.mode === 'base'
        ? game.phase === PHASES.LOBBY && game.teams.size >= LIMITS.minTeams
        : game.phase === PHASES.NAMING && named === game.teams.size && game.teams.size >= LIMITS.minTeams,
  };
}

export function playerView(game, playerId) {
  const player = game.players.get(playerId);
  if (!player) return null;
  const team = game.teamOf(playerId);
  const base = publicView(game);
  const inOptions = game.phase === PHASES.VOTING || game.phase === PHASES.REVEAL;
  const ownOption =
    team && inOptions ? game.options.find((o) => o.kind === 'team' && o.teamId === team.id) : null;
  const size = team ? game.members(team).length : 0;

  return {
    ...base,
    role: 'player',
    me: {
      id: player.id,
      name: player.name,
      teamId: player.teamId,
      ready: game.ready.has(player.id),
    },
    team: team
      ? {
          id: team.id,
          proposal: team.proposal ? { value: team.proposal.value, by: team.proposal.by } : null,
          validations: [...team.validations],
          locked: team.locked,
          notice: team.notice,
          answer: team.answer,
          vote: team.vote,
          ownOptionId: ownOption ? ownOption.id : null,
          hasChat: size >= 2,
          chat: size >= 2 ? team.chat.map((entry) => ({ ...entry })) : [],
        }
      : null,
  };
}
