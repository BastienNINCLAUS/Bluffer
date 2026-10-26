import { initials } from '../../shared/text.js';
import { rankTeams } from '../../shared/ranking.js';

// Données d'un avatar : bordure à la couleur de l'équipe, photo au centre (ou initiales).
export function avatarSpec(player, color, code) {
  return {
    color: color ?? '#6b7280',
    initials: initials(player.name),
    src: player.hasPhoto ? `/photos/${encodeURIComponent(code)}/${encodeURIComponent(player.id)}.jpg?v=${player.photoVersion}` : null,
    name: player.name,
  };
}

export function teamById(view, id) {
  return view.teams.find((t) => t.id === id) ?? null;
}

export function playerById(view, id) {
  return view.players.find((p) => p.id === id) ?? null;
}

export function membersOf(view, team) {
  return team.memberIds.map((id) => playerById(view, id)).filter(Boolean);
}

export function teamLabel(team) {
  return team.name ?? 'Équipe sans nom';
}

// Millisecondes restantes d'un délai annoncé par le serveur (deadlineIn) à la réception.
export function remainingMs(deadlineIn, receivedAt, now) {
  if (deadlineIn === null || deadlineIn === undefined) return null;
  return Math.max(0, deadlineIn - (now - receivedAt));
}

export function formatSeconds(ms) {
  return String(Math.max(0, Math.ceil(ms / 1000)));
}

// Valeur à proposer à l'équipe à partir d'un message du tchat, ou null si impossible dans cette phase.
export function chatProposalValue(text, phase, options = []) {
  if (phase === 'naming' || phase === 'writing') return text;
  if (phase === 'voting') {
    const match = /^\s*#?n?°?\s*(\d+)\s*$/i.exec(text);
    if (match && options.some((o) => o.id === Number(match[1]))) return Number(match[1]);
  }
  return null;
}

export function progressText(team, phase) {
  const { locked, validated, size, hasProposal } = team.progress;
  if (locked) return phase === 'naming' ? 'Nom adopté' : 'Validé';
  if (size === 1) return hasProposal ? 'Validé' : 'Réfléchit…';
  if (!hasProposal) return 'Discute…';
  return `${validated}/${size} ont validé`;
}

// Rang et points d'une équipe pour l'écran de téléphone.
export function standing(view, teamId) {
  const entry = view.ranking.find((r) => r.id === teamId);
  const team = teamById(view, teamId);
  if (!entry || !team) return null;
  const tied = view.ranking.filter((r) => r.rank === entry.rank).length > 1;
  return { rank: entry.rank, total: view.ranking.length, score: team.score, gain: team.gain, tied };
}

export function rankLabel(rank, tied = false) {
  const base = rank === 1 ? '1er' : `${rank}e`;
  return tied ? `${base} ex æquo` : base;
}

// Résultat d'une équipe dans la liste des réponses révélées.
export function ownResult(view, teamId) {
  const revealedAll = view.revealCount >= view.revealTotal && view.revealTotal > 0;
  if (!revealedAll) return null;
  const mine = view.options.find((o) => o.kind === 'team' && o.teamId === teamId);
  return { answerVotes: mine ? mine.voters.length : 0 };
}

export function sortedOptionsForReveal(options) {
  return [...options].sort((a, b) => a.id - b.id);
}

export function teamsInOrder(view) {
  const byId = new Map(view.teams.map((t) => [t.id, t]));
  return rankTeams(view.teams, 'score').map((r) => byId.get(r.id));
}
